import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createRecord,
  type DailyRecord,
  type Entry,
  type IncompleteItem,
} from '@openbook/shared';

import { differsBeyondAmounts, runDaily, type CollectionSource } from '../src/batch.js';
import { getRecord, recordKey } from '../src/storage.js';
import { readRun } from '../src/runlog.js';

const decoder = new TextDecoder();

/** 与えた費用エントリを返すだけの収集ソース。 */
function costSource(id: string, amount: string, revisable = false): CollectionSource {
  return {
    id,
    revisable,
    requestsPerCollection: 0,
    async collect(date) {
      const entry: Entry = {
        source: id,
        category: 'plan',
        acquisition: 'measured',
        revisable,
        currency: 'JPY',
        amount,
        amountJpy: amount,
      };
      return { costs: [entry], revenues: [], raw: { date } };
    },
  };
}

/** 必ず失敗する収集ソース。 */
function failingSource(id: string): CollectionSource {
  return {
    id,
    revisable: false,
    requestsPerCollection: 0,
    collect() {
      throw new Error('HTTP 503');
    },
  };
}

const OPTIONS = { now: '2026-09-08T06:00:00Z', fetchRate: async () => undefined };

beforeEach(async () => {
  const listed = await env.RECORDS.list();
  await Promise.all(listed.objects.map((object) => env.RECORDS.delete(object.key)));
});

describe('収集ソースの登録', () => {
  it('ソース 0 件でも実行が成立し、空のレコードが生成される', async () => {
    await runDaily(env.RECORDS, [], '2026-09-07', OPTIONS);

    const stored = await getRecord(env.RECORDS, '2026-09-07');
    const record = JSON.parse(decoder.decode(stored!));

    expect(record.costs).toEqual([]);
    expect(record.revenues).toEqual([]);
    expect(record.totals.costJpy).toBe('0.00');
  });

  it('複数ソースの結果が 1 件のレコードに統合される', async () => {
    await runDaily(
      env.RECORDS,
      [costSource('claude', '1.00'), costSource('cloudflare', '2.00')],
      '2026-09-07',
      OPTIONS,
    );

    const record = JSON.parse(decoder.decode((await getRecord(env.RECORDS, '2026-09-07'))!));

    expect(record.costs.map((entry: Entry) => entry.source)).toEqual([
      'claude',
      'cloudflare',
    ]);
    expect(record.totals.costJpy).toBe('3.00');
  });
});

describe('収集ソースの部分失敗', () => {
  it('成功分でレコードが生成され、失敗ソースが incomplete と実行記録に残る', async () => {
    await runDaily(
      env.RECORDS,
      [costSource('claude', '1.00'), costSource('cloudflare', '2.00'), failingSource('resend')],
      '2026-09-07',
      OPTIONS,
    );

    const record = JSON.parse(decoder.decode((await getRecord(env.RECORDS, '2026-09-07'))!));

    expect(record.costs).toHaveLength(2);
    expect(record.incomplete).toEqual([
      { kind: 'source', id: 'resend', reason: 'HTTP 503' },
    ]);
    expect(record.totals.incomplete).toBe(true);

    const run = await readRun(env.RECORDS, '2026-09-07');
    expect(run?.sources.find((s) => s.id === 'resend')?.ok).toBe(false);
  });

  it('全ソースが失敗した場合はレコードを生成しない', async () => {
    await runDaily(env.RECORDS, [failingSource('claude')], '2026-09-07', OPTIONS);

    expect(await getRecord(env.RECORDS, '2026-09-07')).toBeNull();
    expect((await readRun(env.RECORDS, '2026-09-07'))?.ok).toBe(false);
  });
});

describe('実行記録', () => {
  it('対象日・時刻・ソースごとの成否・生成リビジョンが記録される', async () => {
    await runDaily(env.RECORDS, [costSource('claude', '1.00')], '2026-09-07', OPTIONS);

    const run = await readRun(env.RECORDS, '2026-09-07');

    expect(run).toMatchObject({
      date: '2026-09-07',
      ok: true,
      revision: 1,
      startedAt: expect.any(String),
      finishedAt: expect.any(String),
    });
    expect(run?.sources).toEqual([{ id: 'claude', ok: true }]);
  });
});

describe('訂正リビジョンを追加する条件', () => {
  it('同一内容ではリビジョンが増えない', async () => {
    const sources = [costSource('claude', '1.00')];
    await runDaily(env.RECORDS, sources, '2026-09-07', OPTIONS);
    await runDaily(env.RECORDS, sources, '2026-09-07', OPTIONS);

    expect(await env.RECORDS.head(recordKey('2026-09-07', 2))).toBeNull();
  });

  it('閾値を超える金額の変化で訂正リビジョンが 1 件追加される', async () => {
    await runDaily(env.RECORDS, [costSource('claude', '1.00')], '2026-09-07', OPTIONS);
    await runDaily(env.RECORDS, [costSource('claude', '5.00')], '2026-09-07', OPTIONS);

    const record = JSON.parse(decoder.decode((await getRecord(env.RECORDS, '2026-09-07'))!));

    expect(record.revision).toBe(2);
    expect(record.correction).toMatchObject({ supersedes: 1 });
    expect(record.totals.costJpy).toBe('5.00');
  });

  it('閾値以下の金額の変化ではリビジョンが増えない', async () => {
    await runDaily(env.RECORDS, [costSource('claude', '1000.00')], '2026-09-07', OPTIONS);
    await runDaily(env.RECORDS, [costSource('claude', '1000.50')], '2026-09-07', OPTIONS);

    expect(await env.RECORDS.head(recordKey('2026-09-07', 2))).toBeNull();

    const record = JSON.parse(decoder.decode((await getRecord(env.RECORDS, '2026-09-07'))!));
    expect(record.totals.costJpy).toBe('1000.00');
  });

  it('閾値以下のため見送った変化が実行記録に残る', async () => {
    await runDaily(env.RECORDS, [costSource('claude', '1000.00')], '2026-09-07', OPTIONS);
    await runDaily(env.RECORDS, [costSource('claude', '1000.50')], '2026-09-07', OPTIONS);

    const run = await readRun(env.RECORDS, '2026-09-07');

    expect(run?.revision).toBe(1);
    expect(run?.deferred?.changes).toEqual([
      { field: 'revenueJpy', existing: '0.00', next: '0.00', difference: '0.00' },
      { field: 'costJpy', existing: '1000.00', next: '1000.50', difference: '0.50' },
    ]);
    expect(run?.deferred?.threshold).toEqual({ maxDifference: '1', maxRatio: '0.01' });
  });

  it('見送らなかった実行では見送りの記録を残さない', async () => {
    await runDaily(env.RECORDS, [costSource('claude', '1.00')], '2026-09-07', OPTIONS);
    await runDaily(env.RECORDS, [costSource('claude', '5.00')], '2026-09-07', OPTIONS);

    expect((await readRun(env.RECORDS, '2026-09-07'))?.deferred).toBeUndefined();
  });

  it('金額が変わらない欠測の解消で訂正リビジョンが追加される', async () => {
    await runDaily(
      env.RECORDS,
      [costSource('claude', '1.00'), failingSource('resend')],
      '2026-09-07',
      OPTIONS,
    );
    await runDaily(
      env.RECORDS,
      [costSource('claude', '1.00'), costSource('resend', '0.00')],
      '2026-09-07',
      OPTIONS,
    );

    const record = JSON.parse(decoder.decode((await getRecord(env.RECORDS, '2026-09-07'))!));

    expect(record.revision).toBe(2);
    expect(record.totals.costJpy).toBe('1.00');
    expect(record.incomplete).toEqual([]);
  });

  /** USD 建ての費用を返す収集ソース。 */
  const usdSource: CollectionSource = {
    id: 'claude',
    revisable: false,
    requestsPerCollection: 0,
    async collect() {
      const entry: Entry = {
        source: 'claude',
        category: 'model',
        acquisition: 'measured',
        revisable: false,
        currency: 'USD',
        amount: '0.010071',
      };
      return { costs: [entry], revenues: [] };
    },
  };

  /**
   * 実行時刻を取得時刻として記録するレート取得を持つ実行の依存を作る。
   *
   * @param now 実行時刻
   * @param rate レート値
   * @returns 実行の依存
   */
  function optionsAt(now: string, rate = '147.25') {
    return {
      now,
      fetchRate: async () => ({
        pair: 'USD/JPY',
        rate,
        provider: 'frankfurter',
        publishedOn: '2026-09-07',
        fetchedAt: now,
      }),
    };
  }

  it('為替レートの取得時刻だけが異なる再実行ではリビジョンが増えない', async () => {
    await runDaily(env.RECORDS, [usdSource], '2026-09-07', optionsAt('2026-09-08T06:00:00Z'));
    await runDaily(env.RECORDS, [usdSource], '2026-09-07', optionsAt('2026-09-09T06:00:00Z'));

    expect(await env.RECORDS.head(recordKey('2026-09-07', 2))).toBeNull();
  });

  it('記録済みのレートは再実行で変わらず、訂正リビジョンも増えない', async () => {
    await runDaily(env.RECORDS, [usdSource], '2026-09-07', optionsAt('2026-09-08T06:00:00Z'));

    // 提供元が別の値を返しても、記録済みのレートを再利用するため内容は変わらない。
    await runDaily(
      env.RECORDS,
      [usdSource],
      '2026-09-07',
      optionsAt('2026-09-09T06:00:00Z', '148.00'),
    );

    expect(await env.RECORDS.head(recordKey('2026-09-07', 2))).toBeNull();
  });

  it('レートを取得できなかった日は、後から取得できると訂正リビジョンが追加される', async () => {
    await runDaily(env.RECORDS, [usdSource], '2026-09-07', {
      now: '2026-09-08T06:00:00Z',
      fetchRate: async () => undefined,
    });

    await runDaily(env.RECORDS, [usdSource], '2026-09-07', optionsAt('2026-09-09T06:00:00Z'));

    expect(await env.RECORDS.head(recordKey('2026-09-07', 2))).not.toBeNull();
  });
});

describe('レコードの違いの分類', () => {
  /** 費用エントリ 1 件のレコードを作る。 */
  function costRecord(entry: Partial<Entry> = {}, incomplete: IncompleteItem[] = []): DailyRecord {
    return createRecord({
      date: '2026-09-07',
      revision: 1,
      generatedAt: '2026-09-08T06:00:00Z',
      costs: [
        {
          source: 'claude',
          category: 'plan',
          acquisition: 'measured',
          revisable: false,
          currency: 'JPY',
          amount: '1.00',
          amountJpy: '1.00',
          ...entry,
        },
      ],
      incomplete,
    });
  }

  it('エントリの金額だけが違う場合は金額のみと判定される', () => {
    expect(differsBeyondAmounts(costRecord(), costRecord({ amount: '2.00', amountJpy: '2.00' }))).toBe(
      false,
    );
  });

  it('欠測の有無が違う場合は金額以外を含むと判定される', () => {
    const withIncomplete = costRecord({}, [
      { kind: 'source', id: 'resend', reason: 'HTTP 503' },
    ]);

    expect(differsBeyondAmounts(costRecord(), withIncomplete)).toBe(true);
  });

  it('エントリの増減がある場合は金額以外を含むと判定される', () => {
    const withoutEntry = createRecord({
      date: '2026-09-07',
      revision: 1,
      generatedAt: '2026-09-08T06:00:00Z',
    });

    expect(differsBeyondAmounts(costRecord(), withoutEntry)).toBe(true);
  });

  it('算出根拠が違う場合は金額以外を含むと判定される', () => {
    const withBasis = costRecord({
      acquisition: 'estimated',
      basis: { description: '月額 0 円の日割り' },
    });

    expect(differsBeyondAmounts(costRecord(), withBasis)).toBe(true);
  });
});
