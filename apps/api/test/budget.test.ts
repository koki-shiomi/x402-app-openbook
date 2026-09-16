import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { createRecord, type DailyRecord } from '@openbook/shared';

import type { CollectionSource } from '../src/batch.js';
import { RequestBudget, RequestBudgetExceededError } from '../src/budget.js';
import { runCollection } from '../src/schedule.js';
import { readCollectionRuns } from '../src/runlog.js';
import { getRecord, putRecord } from '../src/storage.js';

/** 1 日あたり 2 件の問い合わせを行うと宣言する収集ソース。 */
function countingSource(id: string, budget: RequestBudget): CollectionSource {
  return {
    id,
    revisable: true,
    requestsPerCollection: 2,
    async collect(date: string) {
      const fetchImpl = budget.wrap(async () => new Response('{}'));
      await fetchImpl('https://example.invalid/a');
      await fetchImpl('https://example.invalid/b');

      return {
        costs: [],
        revenues: [
          {
            source: id,
            category: 'ads' as const,
            acquisition: 'measured' as const,
            revisable: true,
            currency: 'JPY' as const,
            amount: date.endsWith('1') ? '100.00' : '0.00',
            amountJpy: date.endsWith('1') ? '100.00' : '0.00',
          },
        ],
      };
    },
  };
}

/**
 * 宣言より多く問い合わせる収集ソース。
 *
 * 見積もりでは通るが処理の途中で予算を超える状況を再現する。
 */
function overspendingSource(id: string, budget: RequestBudget): CollectionSource {
  return {
    id,
    revisable: true,
    requestsPerCollection: 1,
    async collect() {
      const fetchImpl = budget.wrap(async () => new Response('{}'));
      await fetchImpl('https://example.invalid/a');
      await fetchImpl('https://example.invalid/b');
      await fetchImpl('https://example.invalid/c');

      return { costs: [], revenues: [] };
    },
  };
}

/** 対象日に最小限のレコードを置く。 */
async function seed(date: string): Promise<void> {
  await putRecord(
    env.RECORDS,
    createRecord({ date, revision: 1, generatedAt: '2026-09-01T06:00:00Z' }),
  );
}

const NOW = '2026-09-20T06:00:00Z';

/** 前日を収集せず、対象期間全体を担当する定期実行。 */
const DUTY = { cron: 'test', collectPreviousDay: false, slice: { from: 2, to: 40 } };

beforeEach(async () => {
  const listed = await env.RECORDS.list();
  await Promise.all(listed.objects.map((object) => env.RECORDS.delete(object.key)));
});

describe('問い合わせ回数の予算', () => {
  it('予算を超える問い合わせは資源制約の失敗になる', async () => {
    const budget = new RequestBudget(2);
    const fetchImpl = budget.wrap(async () => new Response('{}'));

    await fetchImpl('https://example.invalid/a');
    await fetchImpl('https://example.invalid/b');

    await expect(fetchImpl('https://example.invalid/c')).rejects.toBeInstanceOf(
      RequestBudgetExceededError,
    );
    expect(budget.used).toBe(2);
  });

  it('余地の有無を問い合わせ回数から判定できる', () => {
    const budget = new RequestBudget(5);

    expect(budget.canAfford(5)).toBe(true);
    expect(budget.canAfford(6)).toBe(false);
  });
});

describe('予算による再収集の打ち切り', () => {
  it('予算内なら全対象日が処理される', async () => {
    for (const date of ['2026-09-16', '2026-09-17', '2026-09-18']) {
      await seed(date);
    }

    const budget = new RequestBudget(50);
    const outcome = await runCollection(
      env.RECORDS,
      [countingSource('admob', budget)],
      { now: NOW, fetchRate: async () => undefined, budget },
      DUTY,
    );

    expect(outcome.processed).toEqual(['2026-09-16', '2026-09-17', '2026-09-18']);
    expect(outcome.stoppedAt).toBeUndefined();
  });

  it('予算に達したら以降の対象日が処理されない', async () => {
    for (const date of ['2026-09-16', '2026-09-17', '2026-09-18']) {
      await seed(date);
    }

    // 1 日あたりの見積もりは 2 件 + 為替の余地 1 件 = 3 件。2 日分で 4 件使い、
    // 残り 2 件では 3 日目の見積もりに届かないため打ち切られる。
    const budget = new RequestBudget(6);
    const outcome = await runCollection(
      env.RECORDS,
      [countingSource('admob', budget)],
      { now: NOW, fetchRate: async () => undefined, budget },
      DUTY,
    );

    expect(outcome.processed).toEqual(['2026-09-16', '2026-09-17']);
    expect(outcome.stoppedAt).toBe('2026-09-18');
  });

  it('打ち切った対象日と件数が実行記録に残る', async () => {
    for (const date of ['2026-09-16', '2026-09-17', '2026-09-18']) {
      await seed(date);
    }

    const budget = new RequestBudget(6);
    await runCollection(
      env.RECORDS,
      [countingSource('admob', budget)],
      { now: NOW, fetchRate: async () => undefined, budget },
      DUTY,
    );

    const [run] = await readCollectionRuns(env.RECORDS);

    expect(run?.stoppedAt).toBe('2026-09-18');
    expect(run?.requestsUsed).toBe(4);
    expect(run?.requestBudget).toBe(6);
    expect(run?.dates).toEqual(['2026-09-16', '2026-09-17']);
    expect(run?.trigger).toBe('test');
  });
});

describe('処理の途中で予算を超えた対象日', () => {
  /** 予算を途中で使い切る再収集を 1 回行う。 */
  async function runOverspending(limit: number) {
    const budget = new RequestBudget(limit);
    const outcome = await runCollection(
      env.RECORDS,
      [overspendingSource('admob', budget)],
      { now: NOW, fetchRate: async () => undefined, budget },
      DUTY,
    );
    return outcome;
  }

  it('レコードが生成も訂正もされない', async () => {
    await seed('2026-09-18');

    // 見積もりは 1 + 1 = 2 件だが、実際には 3 件の問い合わせを行う。
    const outcome = await runOverspending(2);

    expect(outcome.interrupted).toHaveLength(1);
    expect(outcome.interrupted[0]?.date).toBe('2026-09-18');
    expect(await getRecord(env.RECORDS, '2026-09-18', 2)).toBeNull();

    const record = JSON.parse(
      new TextDecoder().decode((await getRecord(env.RECORDS, '2026-09-18'))!),
    ) as DailyRecord;
    expect(record.revision).toBe(1);
    expect(record.correction).toBeUndefined();
  });

  it('当該提供元が欠測に現れない', async () => {
    await seed('2026-09-18');

    await runOverspending(2);

    const record = JSON.parse(
      new TextDecoder().decode((await getRecord(env.RECORDS, '2026-09-18'))!),
    ) as DailyRecord;

    expect(record.incomplete.some((item) => item.id === 'admob')).toBe(false);
  });

  it('中断した事実と理由が実行記録に残る', async () => {
    await seed('2026-09-18');

    await runOverspending(2);

    const [run] = await readCollectionRuns(env.RECORDS);

    expect(run?.interrupted?.[0]?.date).toBe('2026-09-18');
    expect(run?.interrupted?.[0]?.reason).toMatch(/予算/);
    expect(run?.dates).toEqual([]);
  });

  it('次の実行で余裕があれば通常どおり収集される', async () => {
    await seed('2026-09-18');

    await runOverspending(2);
    const outcome = await runOverspending(50);

    expect(outcome.interrupted).toEqual([]);
    expect(outcome.processed).toEqual(['2026-09-18']);
  });
});
