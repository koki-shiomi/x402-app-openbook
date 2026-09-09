import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Entry } from '@openbook/shared';

import { runDaily, type CollectionSource } from '../src/batch.js';
import { getRecord, recordKey } from '../src/storage.js';
import { readRun } from '../src/runlog.js';

const decoder = new TextDecoder();

/** 与えた費用エントリを返すだけの収集ソース。 */
function costSource(id: string, amount: string, revisable = false): CollectionSource {
  return {
    id,
    revisable,
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

describe('再実行の冪等性', () => {
  it('同一内容の再実行ではリビジョンが増えない', async () => {
    const sources = [costSource('claude', '1.00')];
    await runDaily(env.RECORDS, sources, '2026-09-07', OPTIONS);
    await runDaily(env.RECORDS, sources, '2026-09-07', OPTIONS);

    expect(await env.RECORDS.head(recordKey('2026-09-07', 2))).toBeNull();
  });

  it('内容が変化した再実行では訂正リビジョンが 1 件追加される', async () => {
    await runDaily(env.RECORDS, [costSource('claude', '1.00')], '2026-09-07', OPTIONS);
    await runDaily(env.RECORDS, [costSource('claude', '5.00')], '2026-09-07', OPTIONS);

    const record = JSON.parse(decoder.decode((await getRecord(env.RECORDS, '2026-09-07'))!));

    expect(record.revision).toBe(2);
    expect(record.correction).toMatchObject({ supersedes: 1 });
    expect(record.totals.costJpy).toBe('5.00');
  });
});

describe('クローズ済み月の保護', () => {
  it('クローズ済み月を対象とした実行は拒否される', async () => {
    const { closeMonth } = await import('../src/storage.js');
    await closeMonth(env.RECORDS, '2026-09', { closedAt: '2026-10-06T07:00:00Z' });

    await expect(runDaily(env.RECORDS, [], '2026-09-09', OPTIONS)).rejects.toThrow(
      /クローズ済み/,
    );
  });
});
