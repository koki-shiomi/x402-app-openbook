import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { validateRecord, type DailyRecord } from '@openbook/shared';

import { runDaily, type CollectionSource } from '../src/batch.js';
import { RequestBudget } from '../src/budget.js';
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
    requestsPerCollection: 0,
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
    await recollectRecent(env.RECORDS, [source], { ...OPTIONS, now: '2026-09-07T06:00:00Z' });

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

    // 2026-07-29 は対象期間の外にあり、再収集されない。
    // （2026-07-30 以降の欠落は埋め戻しの対象になるため、完全一致では確かめない）
    expect(calls).not.toContain('2026-07-29');
    expect(calls).toContain('2026-07-30');
  });

  it('稼働期間より前と対象期間外の日には、レコードが作成されない', async () => {
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

    expect(calls).toContain('2026-09-05');
    // 最も古いレコード（2026-09-05）より前は稼働期間の外にあたる。
    expect(await getRecord(env.RECORDS, '2026-09-03')).toBeNull();
    // 前日（2026-09-07）は再収集の対象期間に含まれない。最初の定期実行が担当する。
    expect(await getRecord(env.RECORDS, '2026-09-07')).toBeNull();
  });

  it('値が変化しない日にはリビジョンが増えない', async () => {
    const source = mutableSource(new Map([['2026-09-05', '10.00']]));
    await runDaily(env.RECORDS, [source], '2026-09-05', OPTIONS);

    const outcome = await recollectRecent(env.RECORDS, [source], {
      ...OPTIONS,
      now: '2026-09-07T06:00:00Z',
    });

    // 再収集の対象にはなったが、値が変わらないためリビジョンは増えない。
    expect(outcome.processed).toContain('2026-09-05');
    expect(await env.RECORDS.head(recordKey('2026-09-05', 2))).toBeNull();
  });

  it('翌月初の実行で前月の全日が対象に入る', () => {
    // 前日は最初の定期実行が収集し、それより前の日を再収集が担当する。
    const now = '2026-10-01T06:00:00Z';
    const dates = [previousDay(now), ...recollectionDates(now)];
    const september = Array.from(
      { length: 30 },
      (_unused, index) => `2026-09-${String(index + 1).padStart(2, '0')}`,
    );

    expect(dates).toEqual(expect.arrayContaining(september));
    expect(dates).toHaveLength(40);
    // 前日は先頭に置いた。再収集が担当するのは 2 日前までである。
    expect(dates[0]).toBe('2026-09-30');
    expect(dates.at(-1)).toBe('2026-09-29');
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
    requestsPerCollection: 0,
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

describe('欠落した日の埋め戻し', () => {
  /** 呼ばれた対象日を記録する収集ソース。 */
  function recordingSource() {
    const base = mutableSource(new Map());
    const calls: string[] = [];
    const source: CollectionSource = {
      ...base,
      collect(date) {
        calls.push(date);
        return base.collect(date);
      },
    };

    return { source, calls };
  }

  it('稼働期間内かつ埋め戻しの範囲内で欠落した日が収集される', async () => {
    const { source, calls } = recordingSource();
    // 稼働開始を 2026-09-01 とし、2026-09-05 だけレコードがない状態を作る。
    await runDaily(env.RECORDS, [source], '2026-09-01', { ...OPTIONS, now: '2026-09-02T06:00:00Z' });
    await runDaily(env.RECORDS, [source], '2026-09-06', { ...OPTIONS, now: '2026-09-07T06:00:00Z' });
    calls.length = 0;

    await recollectRecent(env.RECORDS, [source], { ...OPTIONS, now: '2026-09-08T06:00:00Z' });

    expect(calls).toContain('2026-09-05');
    expect(await getRecord(env.RECORDS, '2026-09-05')).not.toBeNull();
  });

  it('稼働期間より前の日は収集されない', async () => {
    const { source, calls } = recordingSource();
    // 最も古いレコードは 2026-09-05。それより前にレコードは作らない。
    await runDaily(env.RECORDS, [source], '2026-09-05', { ...OPTIONS, now: '2026-09-06T06:00:00Z' });
    calls.length = 0;

    await recollectRecent(env.RECORDS, [source], { ...OPTIONS, now: '2026-09-08T06:00:00Z' });

    expect(calls).not.toContain('2026-09-04');
    expect(await getRecord(env.RECORDS, '2026-09-04')).toBeNull();
  });

  it('埋め戻しの範囲より古い欠落は収集されない', async () => {
    const { source, calls } = recordingSource();
    // 稼働開始を 2026-08-20 とし、2026-08-25（実行時点から 14 日前）を欠落させる。
    await runDaily(env.RECORDS, [source], '2026-08-20', { ...OPTIONS, now: '2026-08-21T06:00:00Z' });
    await runDaily(env.RECORDS, [source], '2026-09-06', { ...OPTIONS, now: '2026-09-07T06:00:00Z' });
    calls.length = 0;

    await recollectRecent(env.RECORDS, [source], { ...OPTIONS, now: '2026-09-08T06:00:00Z' });

    expect(calls).not.toContain('2026-08-25');
    expect(await getRecord(env.RECORDS, '2026-08-25')).toBeNull();
  });

  it('中断した前日が翌日の実行で拾われる', async () => {
    const { source, calls } = recordingSource();
    // 2026-09-06 の収集が中断してレコードがない状態を、翌日の実行が拾う。
    await runDaily(env.RECORDS, [source], '2026-09-04', { ...OPTIONS, now: '2026-09-05T06:00:00Z' });
    await runDaily(env.RECORDS, [source], '2026-09-05', { ...OPTIONS, now: '2026-09-06T06:00:00Z' });
    calls.length = 0;

    // 2026-09-07 の実行は前日（09-06）を収集できず、翌 09-08 の実行が 2 日前として拾う。
    await recollectRecent(env.RECORDS, [source], { ...OPTIONS, now: '2026-09-08T06:00:00Z' });

    expect(calls).toContain('2026-09-06');
    expect(await getRecord(env.RECORDS, '2026-09-06')).not.toBeNull();
  });
});

describe('埋め戻しと予算', () => {
  it('予算に余地がなければ欠落した日も収集しない', async () => {
    const base = mutableSource(new Map());
    // 稼働開始を 2026-09-01 とし、以降の日をすべて欠落させる。種まきは予算を使わない。
    await runDaily(env.RECORDS, [base], '2026-09-01', { ...OPTIONS, now: '2026-09-02T06:00:00Z' });

    const calls: string[] = [];
    // 予算は実際の問い合わせで減るため、宣言した回数だけ消費する収集ソースを使う。
    const budget = new RequestBudget(11);
    const source: CollectionSource = {
      ...base,
      requestsPerCollection: 10,
      async collect(date) {
        calls.push(date);
        const fetchImpl = budget.wrap(async () => new Response('{}'));
        for (let index = 0; index < 10; index += 1) {
          await fetchImpl('https://example.invalid/');
        }
        return base.collect(date);
      },
    };

    // 1 日あたり 11 件（ソース 10 + レート 1）と見積もるため、予算 11 では 1 日しか扱えない。
    const outcome = await recollectRecent(env.RECORDS, [source], {
      ...OPTIONS,
      now: '2026-09-08T06:00:00Z',
      budget,
    });

    expect(calls).toHaveLength(1);
    expect(outcome.stoppedAt).toBeDefined();
  });
});
