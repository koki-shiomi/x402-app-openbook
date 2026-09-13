import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { validateRecord, type DailyRecord } from '@openbook/shared';

import { runDaily, type CollectionSource } from '../src/batch.js';
import {
  collectWithinReach,
  previousDay,
  recollectionDates,
  recollectRecent,
} from '../src/schedule.js';
import { readRun } from '../src/runlog.js';
import { getRecord, recordKey } from '../src/storage.js';

const decoder = new TextDecoder();

/** 対象日ごとに与えた金額を返す収集ソース。値を書き換えて改訂を再現する。 */
function mutableSource(amounts: Map<string, string>): CollectionSource {
  return {
    id: 'admob',
    revisable: true,
    collect(date) {
      const amount = amounts.get(date) ?? '0.00';
      return {
        costs: [],
        revenues: [
          {
            source: 'admob',
            category: 'estimated-earnings',
            acquisition: 'measured' as const,
            revisable: true,
            currency: 'JPY' as const,
            amount,
            amountJpy: amount,
          },
        ],
      };
    },
  };
}

const OPTIONS = { now: '2026-09-08T06:00:00Z', fetchRate: async () => undefined };

beforeEach(async () => {
  const listed = await env.RECORDS.list();
  await Promise.all(listed.objects.map((object) => env.RECORDS.delete(object.key)));
});

describe('対象日の算出', () => {
  it('実行時刻から見た前日を UTC 暦日で求める', () => {
    expect(previousDay('2026-09-08T06:00:00Z')).toBe('2026-09-07');
  });

  it('月をまたぐ場合も正しく求める', () => {
    expect(previousDay('2026-09-01T06:00:00Z')).toBe('2026-08-31');
  });

  it('うるう日を扱える', () => {
    expect(previousDay('2028-03-01T06:00:00Z')).toBe('2028-02-29');
  });
});

describe('過去日の再収集', () => {
  it('対象期間内の既存レコードが再収集され、値の変化で訂正リビジョンが追加される', async () => {
    const amounts = new Map([['2026-09-05', '10.00']]);
    const source = mutableSource(amounts);
    await runDaily(env.RECORDS, [source], '2026-09-05', OPTIONS);

    amounts.set('2026-09-05', '18.00');
    await recollectRecent(env.RECORDS, [source], { ...OPTIONS, now: '2026-09-06T06:00:00Z' });

    const record = JSON.parse(decoder.decode((await getRecord(env.RECORDS, '2026-09-05'))!));
    expect(record.revision).toBe(2);
    expect(record.totals.revenueJpy).toBe('18.00');
  });

  it('対象期間より前の既存レコードは再収集されない', async () => {
    // 2026-09-08 の実行では 2026-07-30 までが対象になる。
    const amounts = new Map([
      ['2026-07-29', '10.00'],
      ['2026-07-30', '10.00'],
    ]);
    const base = mutableSource(amounts);
    const calls: string[] = [];
    const source: CollectionSource = {
      ...base,
      collect(date) {
        calls.push(date);
        return base.collect(date);
      },
    };
    await runDaily(env.RECORDS, [source], '2026-07-29', { ...OPTIONS, now: '2026-07-30T06:00:00Z' });
    await runDaily(env.RECORDS, [source], '2026-07-30', { ...OPTIONS, now: '2026-07-31T06:00:00Z' });
    calls.length = 0;

    await recollectRecent(env.RECORDS, [source], { ...OPTIONS, now: '2026-09-08T06:00:00Z' });

    expect(calls).toEqual(['2026-07-30']);
  });

  it('レコードがない対象期間内の日は収集されず、レコードも作成されない', async () => {
    const amounts = new Map([['2026-09-05', '10.00']]);
    const base = mutableSource(amounts);
    const calls: string[] = [];
    const source: CollectionSource = {
      ...base,
      collect(date) {
        calls.push(date);
        return base.collect(date);
      },
    };
    await runDaily(env.RECORDS, [source], '2026-09-05', { ...OPTIONS, now: '2026-09-06T06:00:00Z' });
    calls.length = 0;

    await recollectRecent(env.RECORDS, [source], { ...OPTIONS, now: '2026-09-08T06:00:00Z' });

    expect(calls).toEqual(['2026-09-05']);
    expect(await getRecord(env.RECORDS, '2026-09-03')).toBeNull();
    expect(await getRecord(env.RECORDS, '2026-09-07')).toBeNull();
  });

  it('値が変化しない日にはリビジョンが増えない', async () => {
    const source = mutableSource(new Map([['2026-09-05', '10.00']]));
    await runDaily(env.RECORDS, [source], '2026-09-05', OPTIONS);

    await recollectRecent(env.RECORDS, [source], { ...OPTIONS, now: '2026-09-06T06:00:00Z' });

    expect(await env.RECORDS.head(recordKey('2026-09-05', 2))).toBeNull();
  });

  it('翌月初の実行で前月の全日が対象に入る', () => {
    const dates = recollectionDates('2026-10-01T06:00:00Z');
    const september = Array.from(
      { length: 30 },
      (_unused, index) => `2026-09-${String(index + 1).padStart(2, '0')}`,
    );

    expect(dates).toEqual(expect.arrayContaining(september));
    expect(dates).toHaveLength(40);
    expect(dates.at(-1)).toBe('2026-09-30');
  });
});

/**
 * 実行時刻が期限より前のときだけ取得できる、USD 建ての収集ソース。
 * 過去日の状態を取得できない提供元（Supabase など）を模す。
 *
 * @param reachableUntil この時刻以降の実行では取得できないと判定する
 * @param fail 取得を失敗させる場合は true
 * @returns 収集ソースと、collect が呼ばれた対象日の記録
 */
function reachLimitedSource(reachableUntil: string, fail = false) {
  const calls: string[] = [];
  const source: CollectionSource = {
    id: 'limited',
    revisable: false,
    canCollect: (_date, now) => now < reachableUntil,
    collect(date) {
      calls.push(date);
      if (fail) {
        throw new Error('HTTP 503');
      }
      return {
        costs: [
          {
            source: 'limited',
            category: 'plan',
            acquisition: 'estimated' as const,
            revisable: false,
            currency: 'USD' as const,
            amount: '1.000000',
            basis: { description: '月額 1 USD の日割り' },
          },
        ],
        revenues: [],
      };
    },
  };

  return { source, calls };
}

/**
 * 実行時刻を取得時刻として記録するレート取得を持つ実行の依存を作る。
 *
 * @param now 実行時刻
 * @returns 実行の依存
 */
function rateOptionsAt(now: string) {
  return {
    now,
    fetchRate: async () => ({
      pair: 'USD/JPY',
      rate: '150.00',
      provider: 'frankfurter',
      publishedOn: '2026-09-04',
      fetchedAt: now,
    }),
  };
}

/**
 * 対象日の最新リビジョンを読み出す。
 *
 * @param date 対象日
 * @returns 最新リビジョンのレコード
 */
async function latest(date: string): Promise<DailyRecord> {
  return JSON.parse(decoder.decode((await getRecord(env.RECORDS, date))!)) as DailyRecord;
}

describe('遡及可能期間外の収集ソースの引き継ぎ', () => {
  it('当月中の再収集で、期間外のソースは呼び出されず既存のエントリが引き継がれる', async () => {
    const amounts = new Map([['2026-09-05', '10.00']]);
    const limited = reachLimitedSource('2026-09-07T00:00:00Z');
    const sources = [mutableSource(amounts), limited.source];
    await runDaily(env.RECORDS, sources, '2026-09-05', rateOptionsAt('2026-09-06T06:00:00Z'));

    amounts.set('2026-09-05', '20.00');
    limited.calls.length = 0;
    await recollectRecent(env.RECORDS, sources, rateOptionsAt('2026-09-08T06:00:00Z'));

    const record = await latest('2026-09-05');
    expect(record.revision).toBe(2);
    expect(limited.calls).toEqual([]);
    expect(record.revenues[0]?.amount).toBe('20.00');
    expect(record.costs).toEqual([
      expect.objectContaining({ source: 'limited', amount: '1.000000', amountJpy: '150.00' }),
    ]);
    expect(validateRecord(record)).toEqual([]);
  });

  it('前月に属する日の再収集でも、期間外のソースは呼び出されず既存のエントリが引き継がれる', async () => {
    const amounts = new Map([['2026-08-31', '10.00']]);
    const limited = reachLimitedSource('2026-09-02T00:00:00Z');
    const sources = [mutableSource(amounts), limited.source];
    await runDaily(env.RECORDS, sources, '2026-08-31', rateOptionsAt('2026-09-01T06:00:00Z'));

    amounts.set('2026-08-31', '20.00');
    limited.calls.length = 0;
    await recollectRecent(env.RECORDS, sources, rateOptionsAt('2026-09-06T07:00:00Z'));

    const record = await latest('2026-08-31');
    expect(limited.calls).toEqual([]);
    expect(record.revenues[0]?.amount).toBe('20.00');
    expect(record.costs).toEqual([
      expect.objectContaining({ source: 'limited', amount: '1.000000', amountJpy: '150.00' }),
    ]);
    expect(validateRecord(record)).toEqual([]);
  });

  it('手動再実行でも、期間外のソースは呼び出されず既存のエントリが引き継がれる', async () => {
    const amounts = new Map([['2026-09-05', '10.00']]);
    const limited = reachLimitedSource('2026-09-07T00:00:00Z');
    const sources = [mutableSource(amounts), limited.source];
    await runDaily(env.RECORDS, sources, '2026-09-05', rateOptionsAt('2026-09-06T06:00:00Z'));

    amounts.set('2026-09-05', '20.00');
    limited.calls.length = 0;
    await collectWithinReach(env.RECORDS, sources, '2026-09-05', rateOptionsAt('2026-09-08T06:00:00Z'));

    const record = await latest('2026-09-05');
    expect(record.revision).toBe(2);
    expect(limited.calls).toEqual([]);
    expect(record.revenues[0]?.amount).toBe('20.00');
    expect(record.costs).toEqual([
      expect.objectContaining({ source: 'limited', amount: '1.000000', amountJpy: '150.00' }),
    ]);
    expect(validateRecord(record)).toEqual([]);
  });

  it('期間外のソースの欠測の記録も引き継がれる', async () => {
    const amounts = new Map([['2026-09-05', '10.00']]);
    const limited = reachLimitedSource('2026-09-07T00:00:00Z', true);
    const sources = [mutableSource(amounts), limited.source];
    await runDaily(env.RECORDS, sources, '2026-09-05', rateOptionsAt('2026-09-06T06:00:00Z'));

    amounts.set('2026-09-05', '20.00');
    await recollectRecent(env.RECORDS, sources, rateOptionsAt('2026-09-08T06:00:00Z'));

    const record = await latest('2026-09-05');
    expect(record.revision).toBe(2);
    expect(record.incomplete).toEqual([
      expect.objectContaining({ kind: 'source', id: 'limited', reason: 'HTTP 503' }),
    ]);
    expect(record.totals.incomplete).toBe(true);
  });

  it('引き継ぐ値がある場合は欠測を追加しない', async () => {
    const amounts = new Map([['2026-09-05', '10.00']]);
    const limited = reachLimitedSource('2026-09-07T00:00:00Z');
    const sources = [mutableSource(amounts), limited.source];
    await runDaily(env.RECORDS, sources, '2026-09-05', rateOptionsAt('2026-09-06T06:00:00Z'));

    amounts.set('2026-09-05', '20.00');
    await recollectRecent(env.RECORDS, sources, rateOptionsAt('2026-09-08T06:00:00Z'));

    const record = await latest('2026-09-05');
    expect(record.revision).toBe(2);
    expect(record.incomplete).toEqual([]);
    expect(record.totals.incomplete).toBe(false);
  });

  it('既存のレコードに期間外のソースの値がない日の再収集では、欠測として記録される', async () => {
    const amounts = new Map([['2026-09-05', '10.00']]);
    const limited = reachLimitedSource('2026-09-07T00:00:00Z');
    // 期間外のソースを含まずに作成されたレコード（本チェンジより前のレコードを模す）。
    await runDaily(env.RECORDS, [mutableSource(amounts)], '2026-09-05', rateOptionsAt('2026-09-06T06:00:00Z'));

    await recollectRecent(
      env.RECORDS,
      [mutableSource(amounts), limited.source],
      rateOptionsAt('2026-09-08T06:00:00Z'),
    );

    const record = await latest('2026-09-05');
    expect(limited.calls).toEqual([]);
    expect(record.revision).toBe(2);
    expect(record.incomplete).toEqual([
      { kind: 'source', id: 'limited', reason: expect.stringMatching(/遡及可能期間外/) },
    ]);
    expect(record.totals.incomplete).toBe(true);
    expect(validateRecord(record)).toEqual([]);
  });

  it('レコードがない日の手動再実行では、期間外のソースは欠測として記録される', async () => {
    const limited = reachLimitedSource('2026-09-07T00:00:00Z');

    const result = await collectWithinReach(
      env.RECORDS,
      [mutableSource(new Map([['2026-09-05', '10.00']])), limited.source],
      '2026-09-05',
      rateOptionsAt('2026-09-08T06:00:00Z'),
    );

    expect(limited.calls).toEqual([]);
    expect(result.record?.incomplete).toEqual([
      { kind: 'source', id: 'limited', reason: expect.stringMatching(/遡及可能期間外/) },
    ]);
  });

  it('日次実行で、呼び出さなかった取得元が実行記録に残る', async () => {
    const amounts = new Map([['2026-09-05', '10.00']]);
    const limited = reachLimitedSource('2026-09-07T00:00:00Z');
    const sources = [mutableSource(amounts), limited.source];
    await runDaily(env.RECORDS, sources, '2026-09-05', rateOptionsAt('2026-09-06T06:00:00Z'));

    amounts.set('2026-09-05', '20.00');
    await recollectRecent(env.RECORDS, sources, rateOptionsAt('2026-09-08T06:00:00Z'));

    expect((await readRun(env.RECORDS, '2026-09-05'))?.skippedSources).toEqual(['limited']);
  });

  it('手動再実行でも、呼び出さなかった取得元が実行記録に残る', async () => {
    const amounts = new Map([['2026-09-05', '10.00']]);
    const limited = reachLimitedSource('2026-09-07T00:00:00Z');
    const sources = [mutableSource(amounts), limited.source];
    await runDaily(env.RECORDS, sources, '2026-09-05', rateOptionsAt('2026-09-06T06:00:00Z'));

    amounts.set('2026-09-05', '20.00');
    await collectWithinReach(
      env.RECORDS,
      sources,
      '2026-09-05',
      rateOptionsAt('2026-09-08T06:00:00Z'),
    );

    expect((await readRun(env.RECORDS, '2026-09-05'))?.skippedSources).toEqual(['limited']);
  });

  it('すべてのソースが期間外の日は収集せず、既存のリビジョンを維持する', async () => {
    const limited = reachLimitedSource('2026-09-07T00:00:00Z');
    await runDaily(env.RECORDS, [limited.source], '2026-09-05', rateOptionsAt('2026-09-06T06:00:00Z'));
    limited.calls.length = 0;

    const result = await collectWithinReach(
      env.RECORDS,
      [limited.source],
      '2026-09-05',
      rateOptionsAt('2026-09-08T06:00:00Z'),
    );

    expect(limited.calls).toEqual([]);
    expect(result.skipped).toEqual(['limited']);
    expect(await env.RECORDS.head(recordKey('2026-09-05', 2))).toBeNull();
  });
});
