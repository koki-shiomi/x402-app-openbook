import { describe, expect, it, vi } from 'vitest';

import { createCloudflareSource } from '../../src/sources/cloudflare.js';

const CONFIG = { token: 'cf-token', accountId: 'acc-1' };

/** URL ごとに応答を返すフェッチ関数と、呼び出された URL の記録を作る。 */
function stubFetch(routes: Record<string, unknown>) {
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const key = Object.keys(routes).find((route) => url.includes(route));
    if (key === undefined) {
      return new Response('{}', { status: 404 });
    }
    return new Response(JSON.stringify(routes[key]), { status: 200 });
  }) as unknown as typeof fetch;

  return { fetchImpl, calls };
}

/** 無料枠内の応答（実測に基づく）。 */
const FREE_TIER = {
  '/subscriptions': { result: [], success: true },
  '/billable-usage': { result: [], success: true },
  '/billing/history': { result: [], success: true },
};

describe('無料枠内での運用', () => {
  it('3 点すべてを満たすと金額 0 の estimated エントリになる', async () => {
    const { fetchImpl } = stubFetch(FREE_TIER);
    const source = createCloudflareSource(CONFIG, { fetchImpl });

    const [entry] = (await source.collect('2026-09-08')).costs;

    expect(entry).toMatchObject({
      source: 'cloudflare',
      acquisition: 'estimated',
      revisable: false,
      currency: 'JPY',
      amount: '0.00',
      amountJpy: '0.00',
    });
  });

  it('3 点の確認結果が算出根拠に含まれる', async () => {
    const { fetchImpl } = stubFetch(FREE_TIER);
    const source = createCloudflareSource(CONFIG, { fetchImpl });

    const [entry] = (await source.collect('2026-09-08')).costs;

    expect(entry?.basis?.description).toMatch(/サブスクリプション/);
    expect(entry?.basis?.description).toMatch(/従量課金/);
    expect(entry?.basis?.description).toMatch(/請求/);
  });
});

describe('費用が発生している場合', () => {
  it('有料サブスクリプションがあれば 0 円として記録しない', async () => {
    const { fetchImpl } = stubFetch({
      ...FREE_TIER,
      '/subscriptions': {
        result: [{ id: 's1', price: 5, state: 'Paid', rate_plan: { id: 'workers_paid' } }],
        success: true,
      },
    });
    const source = createCloudflareSource(CONFIG, { fetchImpl });

    await expect(source.collect('2026-09-08')).rejects.toThrow(/サブスクリプション/);
  });

  it('従量課金があれば 0 円として記録しない', async () => {
    const { fetchImpl } = stubFetch({
      ...FREE_TIER,
      '/billable-usage': {
        result: [{ BilledCost: 1.23, ServiceName: 'Workers' }],
        success: true,
      },
    });
    const source = createCloudflareSource(CONFIG, { fetchImpl });

    await expect(source.collect('2026-09-08')).rejects.toThrow(/従量課金/);
  });

  it('対象日に請求があれば 0 円として記録しない', async () => {
    const { fetchImpl } = stubFetch({
      ...FREE_TIER,
      '/billing/history': {
        result: [{ type: 'invoice', occurred_at: '2026-09-08T10:00:00Z', amount: 5.0 }],
        success: true,
      },
    });
    const source = createCloudflareSource(CONFIG, { fetchImpl });

    await expect(source.collect('2026-09-08')).rejects.toThrow(/請求/);
  });

  it('対象日以外の請求は判定に影響しない', async () => {
    const { fetchImpl } = stubFetch({
      ...FREE_TIER,
      '/billing/history': {
        result: [{ type: 'invoice', occurred_at: '2026-05-07T10:29:35Z', amount: 15.62 }],
        success: true,
      },
    });
    const source = createCloudflareSource(CONFIG, { fetchImpl });

    expect((await source.collect('2026-09-08')).costs).toHaveLength(1);
  });
});

describe('対象外とする費用', () => {
  it('ドメイン登録費は費用エントリに含まれない', async () => {
    const { fetchImpl } = stubFetch({
      ...FREE_TIER,
      '/billing/history': {
        result: [
          {
            type: 'invoice',
            occurred_at: '2026-09-08T10:00:00Z',
            amount: 15.62,
            description: 'Domain Registration sizet.app',
          },
        ],
        success: true,
      },
    });
    const source = createCloudflareSource(CONFIG, { fetchImpl });

    const result = await source.collect('2026-09-08');

    expect(result.costs.every((entry) => entry.amount === '0.00')).toBe(true);
  });

  it('対象外の費用があったことが判別できる', async () => {
    const { fetchImpl } = stubFetch({
      ...FREE_TIER,
      '/billing/history': {
        result: [
          {
            type: 'invoice',
            occurred_at: '2026-09-08T10:00:00Z',
            amount: 15.62,
            description: 'Domain Registration sizet.app',
          },
        ],
        success: true,
      },
    });
    const source = createCloudflareSource(CONFIG, { fetchImpl });

    const [entry] = (await source.collect('2026-09-08')).costs;

    expect(entry?.basis?.description).toMatch(/対象外/);
  });
});

describe('従量課金の取得期間', () => {
  it('1 回の要求で 31 日を超える期間を指定しない', async () => {
    const { fetchImpl, calls } = stubFetch(FREE_TIER);
    const source = createCloudflareSource(CONFIG, { fetchImpl });

    await source.collect('2026-09-08');

    const usageCalls = calls.filter((url) => url.includes('/billable-usage'));
    for (const url of usageCalls) {
      const from = new URL(url).searchParams.get('from');
      const to = new URL(url).searchParams.get('to');
      const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000;
      expect(days).toBeLessThanOrEqual(31);
    }
    expect(usageCalls.length).toBeGreaterThan(0);
  });
});

describe('呼び出さないエンドポイント', () => {
  it('請求プロフィールを呼び出さない', async () => {
    const { fetchImpl, calls } = stubFetch(FREE_TIER);
    const source = createCloudflareSource(CONFIG, { fetchImpl });

    await source.collect('2026-09-08');

    expect(calls.some((url) => url.includes('/billing/profile'))).toBe(false);
  });
});

describe('生応答の保存', () => {
  it('3 つの応答をまとめて保存対象として返す', async () => {
    const { fetchImpl } = stubFetch(FREE_TIER);
    const source = createCloudflareSource(CONFIG, { fetchImpl });

    const raw = (await source.collect('2026-09-08')).raw as Record<string, unknown>;

    expect(Object.keys(raw).sort()).toEqual(['billableUsage', 'billingHistory', 'subscriptions']);
  });
});
