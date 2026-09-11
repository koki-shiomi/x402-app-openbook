import { describe, expect, it, vi } from 'vitest';

import { createCloudflareSource, splitUsageRange } from '../../src/sources/cloudflare.js';

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

/** 従量課金の行に入るアカウント名。実測では請求先のメールアドレスを含む（ここでは架空の値）。 */
const ACCOUNT_NAME = "owner@example.com's Account";

/**
 * 従量課金の 1 行を作る。2026-09-09 の実測応答（無料枠内の R2 利用）をもとにしている。
 *
 * @param overrides 上書きする項目
 * @returns 従量課金の 1 行
 */
function usageRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    BillingAccountId: 'acc-1',
    BillingAccountName: ACCOUNT_NAME,
    BillingCurrency: 'USD',
    BilledCost: 0,
    EffectiveCost: 0,
    ListCost: 0,
    ChargeCategory: 'Usage',
    ChargePeriodStart: '2026-09-08T00:00:00Z',
    ChargePeriodEnd: '2026-09-09T00:00:00Z',
    ServiceFamilyName: 'R2',
    ServiceName: 'R2 Storage Class A Operations (First 1M included)',
    ConsumedQuantity: 9,
    ...overrides,
  };
}

/** 無料枠に含まれる R2 の利用 3 行。 */
const R2_FREE_ROWS = [
  usageRow(),
  usageRow({
    ServiceName: 'R2 Data Storage (First 10GB-Month included)',
    ConsumedQuantity: 1.3033333333333333e-8,
    ConsumedUnit: 'GB-months',
  }),
  usageRow({
    ServiceName: 'R2 Storage Class B Operations (First 10M included)',
    ConsumedQuantity: 20,
  }),
];

/**
 * 従量課金の応答だけを差し替えたフェッチ関数を作る。
 *
 * @param rows 従量課金の行
 * @returns フェッチ関数と呼び出し記録
 */
function stubWithUsage(rows: unknown[]) {
  return stubFetch({ ...FREE_TIER, '/billable-usage': { result: rows, success: true } });
}

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

describe('無料枠に含まれる利用がある', () => {
  it('請求額 0 の行のみなら金額 0 の estimated エントリになる', async () => {
    const { fetchImpl } = stubWithUsage(R2_FREE_ROWS);
    const source = createCloudflareSource(CONFIG, { fetchImpl });

    const [entry] = (await source.collect('2026-09-08')).costs;

    expect(entry).toMatchObject({
      source: 'cloudflare',
      acquisition: 'estimated',
      amount: '0.00',
      amountJpy: '0.00',
    });
  });

  it('従量課金の行数と請求額の合計が算出根拠に含まれる', async () => {
    const { fetchImpl } = stubWithUsage(R2_FREE_ROWS);
    const source = createCloudflareSource(CONFIG, { fetchImpl });

    const [entry] = (await source.collect('2026-09-08')).costs;

    expect(entry?.basis?.description).toMatch(/従量課金 3 行/);
    expect(entry?.basis?.description).toMatch(/請求額の合計 0/);
  });

  it('相殺して合計が 0 になる請求額は 0 円として記録される', async () => {
    const { fetchImpl } = stubWithUsage([
      usageRow({ BilledCost: 0.1 }),
      usageRow({ BilledCost: 0.2 }),
      usageRow({ BilledCost: -0.3 }),
    ]);
    const source = createCloudflareSource(CONFIG, { fetchImpl });

    const [entry] = (await source.collect('2026-09-08')).costs;

    expect(entry?.amount).toBe('0.00');
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

  it('従量課金の請求額の合計が 0 でなければ 0 円として記録しない', async () => {
    const { fetchImpl } = stubWithUsage([{ BilledCost: 1.23, ServiceName: 'Workers' }]);
    const source = createCloudflareSource(CONFIG, { fetchImpl });

    await expect(source.collect('2026-09-08')).rejects.toThrow(/従量課金/);
  });

  it('請求額 0 の行に請求額のある行が混ざれば 0 円として記録しない', async () => {
    const { fetchImpl } = stubWithUsage([...R2_FREE_ROWS, usageRow({ BilledCost: 0.36 })]);
    const source = createCloudflareSource(CONFIG, { fetchImpl });

    await expect(source.collect('2026-09-08')).rejects.toThrow(/従量課金/);
  });

  it('指数表記になる微小な請求額も費用として扱う', async () => {
    const { fetchImpl } = stubWithUsage([usageRow({ BilledCost: 1e-7 })]);
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

describe('従量課金の請求額を確認できない', () => {
  const withoutBilledCost = usageRow();
  delete withoutBilledCost.BilledCost;

  it.each([
    ['請求額の項目がない', withoutBilledCost],
    ['請求額が null の', usageRow({ BilledCost: null })],
    ['請求額が数値でない', usageRow({ BilledCost: '0' })],
  ])('%s行があれば 0 円として記録しない', async (_label, row) => {
    const { fetchImpl } = stubWithUsage([...R2_FREE_ROWS, row]);
    const source = createCloudflareSource(CONFIG, { fetchImpl });

    await expect(source.collect('2026-09-08')).rejects.toThrow(/請求額/);
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
  it('対象日 1 日分の要求では終端に翌日を指定する', async () => {
    const { fetchImpl, calls } = stubFetch(FREE_TIER);
    const source = createCloudflareSource(CONFIG, { fetchImpl });

    await source.collect('2026-09-08');

    const usageCalls = calls.filter((url) => url.includes('/billable-usage'));
    expect(usageCalls).toHaveLength(1);
    expect(new URL(usageCalls[0]!).searchParams.get('from')).toBe('2026-09-08');
    expect(new URL(usageCalls[0]!).searchParams.get('to')).toBe('2026-09-09');
  });

  it('1 回の要求で 90 日を超える期間を指定せず、終端は開始より後になる', async () => {
    const { fetchImpl, calls } = stubFetch(FREE_TIER);
    const source = createCloudflareSource(CONFIG, { fetchImpl });

    await source.collect('2026-09-08');

    const usageCalls = calls.filter((url) => url.includes('/billable-usage'));
    for (const url of usageCalls) {
      const from = new URL(url).searchParams.get('from');
      const to = new URL(url).searchParams.get('to');
      const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000;
      expect(days).toBeGreaterThan(0);
      expect(days).toBeLessThanOrEqual(90);
    }
    expect(usageCalls.length).toBeGreaterThan(0);
  });

  it('90 日を超える期間は 90 日以内の連続した区間に分割される', () => {
    expect(splitUsageRange('2026-01-01', '2026-07-31')).toEqual([
      { from: '2026-01-01', to: '2026-04-01' },
      { from: '2026-04-01', to: '2026-06-30' },
      { from: '2026-06-30', to: '2026-08-01' },
    ]);
  });

  it('90 日ちょうどの期間は 1 回で取得される', () => {
    expect(splitUsageRange('2026-06-03', '2026-08-31')).toEqual([
      { from: '2026-06-03', to: '2026-09-01' },
    ]);
  });

  it('91 日の期間は 2 回に分割される', () => {
    expect(splitUsageRange('2026-06-02', '2026-08-31')).toEqual([
      { from: '2026-06-02', to: '2026-08-31' },
      { from: '2026-08-31', to: '2026-09-01' },
    ]);
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

  it('従量課金の各行からアカウント名が除かれる', async () => {
    const { fetchImpl } = stubWithUsage(R2_FREE_ROWS);
    const source = createCloudflareSource(CONFIG, { fetchImpl });

    const raw = (await source.collect('2026-09-08')).raw as { billableUsage: object[] };

    expect(raw.billableUsage).toHaveLength(3);
    for (const row of raw.billableUsage) {
      expect(row).not.toHaveProperty('BillingAccountName');
    }
    expect(JSON.stringify(raw)).not.toContain(ACCOUNT_NAME);
  });

  it('請求額など判定に用いた項目は残る', async () => {
    const { fetchImpl } = stubWithUsage(R2_FREE_ROWS);
    const source = createCloudflareSource(CONFIG, { fetchImpl });

    const raw = (await source.collect('2026-09-08')).raw as { billableUsage: object[] };

    expect(raw.billableUsage[0]).toMatchObject({
      BilledCost: 0,
      BillingCurrency: 'USD',
      ServiceName: 'R2 Storage Class A Operations (First 1M included)',
    });
  });
});

/**
 * サブスクリプション 1 件を作る。2026-09-10 の実測応答（R2 を有効にした際に作成された価格 0 の契約）をもとにしている。
 *
 * @param overrides 上書きする項目
 * @returns サブスクリプション 1 件
 */
function subscription(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'sub-1',
    price: 0,
    currency: 'USD',
    frequency: 'monthly',
    state: 'Paid',
    client_secrets: null,
    rate_plan: { id: 'r2_paid', public_name: 'R2 Paid', currency: 'USD', scope: 'account' },
    product: { name: 'prod_r2', public_name: 'R2 Paid' },
    ...overrides,
  };
}

/**
 * サブスクリプションの応答だけを差し替えたフェッチ関数を作る。
 *
 * @param subscriptions サブスクリプションの一覧
 * @returns フェッチ関数と呼び出し記録
 */
function stubWithSubscriptions(subscriptions: unknown[]) {
  return stubFetch({ ...FREE_TIER, '/subscriptions': { result: subscriptions, success: true } });
}

describe('価格 0 のサブスクリプションのみが存在する', () => {
  it('金額 0 の estimated エントリになる', async () => {
    const { fetchImpl } = stubWithSubscriptions([subscription()]);
    const source = createCloudflareSource(CONFIG, { fetchImpl });

    const [entry] = (await source.collect('2026-09-08')).costs;

    expect(entry).toMatchObject({
      source: 'cloudflare',
      acquisition: 'estimated',
      amount: '0.00',
      amountJpy: '0.00',
    });
  });

  it('サブスクリプションの件数とプラン名が算出根拠に含まれる', async () => {
    const { fetchImpl } = stubWithSubscriptions([subscription()]);
    const source = createCloudflareSource(CONFIG, { fetchImpl });

    const [entry] = (await source.collect('2026-09-08')).costs;

    expect(entry?.basis?.description).toMatch(/サブスクリプション 1 件/);
    expect(entry?.basis?.description).toMatch(/R2 Paid/);
  });
});

describe('有料サブスクリプションが混ざる場合', () => {
  it('価格 0 の契約に価格のある契約が混ざれば 0 円として記録しない', async () => {
    const { fetchImpl } = stubWithSubscriptions([
      subscription(),
      subscription({ price: 5, rate_plan: { id: 'workers_paid', public_name: 'Workers Paid' } }),
    ]);
    const source = createCloudflareSource(CONFIG, { fetchImpl });

    await expect(source.collect('2026-09-08')).rejects.toThrow(/サブスクリプション/);
  });
});

describe('サブスクリプションの価格を確認できない', () => {
  const withoutPrice = subscription();
  delete withoutPrice.price;

  it.each([
    ['価格の項目がない', withoutPrice],
    ['価格が null の', subscription({ price: null })],
    ['価格が数値でない', subscription({ price: '0' })],
  ])('%s契約があれば 0 円として記録しない', async (_label, row) => {
    const { fetchImpl } = stubWithSubscriptions([subscription(), row]);
    const source = createCloudflareSource(CONFIG, { fetchImpl });

    await expect(source.collect('2026-09-08')).rejects.toThrow(/価格/);
  });
});

describe('サブスクリプションの生応答の保存', () => {
  const secret = 'pi_123_secret_abc';

  it('各契約から client_secrets が除かれる', async () => {
    const { fetchImpl } = stubWithSubscriptions([
      subscription({ client_secrets: { payment: secret } }),
    ]);
    const source = createCloudflareSource(CONFIG, { fetchImpl });

    const raw = (await source.collect('2026-09-08')).raw as { subscriptions: object[] };

    expect(raw.subscriptions).toHaveLength(1);
    expect(raw.subscriptions[0]).not.toHaveProperty('client_secrets');
    expect(JSON.stringify(raw)).not.toContain(secret);
  });

  it('価格とプランなど判定に用いた項目は残る', async () => {
    const { fetchImpl } = stubWithSubscriptions([
      subscription({ client_secrets: { payment: secret } }),
    ]);
    const source = createCloudflareSource(CONFIG, { fetchImpl });

    const raw = (await source.collect('2026-09-08')).raw as { subscriptions: object[] };

    expect(raw.subscriptions[0]).toMatchObject({
      price: 0,
      rate_plan: { id: 'r2_paid', public_name: 'R2 Paid' },
    });
  });
});

describe('過去日の扱い', () => {
  const NOW = '2026-09-10T06:00:00Z';

  it('当日および前日は取得可能と判定される', () => {
    const source = createCloudflareSource(CONFIG, {});

    expect(source.canCollect?.('2026-09-09', NOW)).toBe(true);
    expect(source.canCollect?.('2026-09-10', NOW)).toBe(true);
  });

  it('それより前の対象日は取得できないと判定される', () => {
    const source = createCloudflareSource(CONFIG, {});

    expect(source.canCollect?.('2026-09-08', NOW)).toBe(false);
    expect(source.canCollect?.('2026-08-01', NOW)).toBe(false);
  });
});
