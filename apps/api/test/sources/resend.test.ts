import { describe, expect, it, vi } from 'vitest';

import { createResendSource } from '../../src/sources/resend.js';

/** metrics の応答を模したフェッチ関数を作る。 */
function stubFetch(body: unknown, ok = true) {
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response(JSON.stringify(body), { status: ok ? 200 : 500 });
  }) as unknown as typeof fetch;

  return { fetchImpl, calls };
}

/** 実測した応答形式（dimensions=period）。 */
const METRICS = {
  object: 'metrics',
  granularity: 'daily',
  data: [
    { period: '2026-09-07', sent: 3, delivered: 3 },
    { period: '2026-09-08', sent: 5, delivered: 5 },
  ],
};

const FREE = { apiKey: 're_x', plan: 'free' };
const PAID = { apiKey: 're_x', plan: 'pro', monthlyAmountUsd: '20.00' };
const NOW = '2026-09-09T06:00:00Z';

describe('無料プランの宣言', () => {
  it('金額 0 の estimated エントリになる', async () => {
    const { fetchImpl } = stubFetch(METRICS);
    const source = createResendSource(FREE, { fetchImpl });

    const [entry] = (await source.collect('2026-09-08')).costs;

    expect(entry).toMatchObject({
      source: 'resend',
      acquisition: 'estimated',
      revisable: false,
      currency: 'JPY',
      amount: '0.00',
      amountJpy: '0.00',
    });
  });

  it('プラン名と対象日の送信数が算出根拠に含まれる', async () => {
    const { fetchImpl } = stubFetch(METRICS);
    const source = createResendSource(FREE, { fetchImpl });

    const [entry] = (await source.collect('2026-09-08')).costs;

    expect(entry?.basis?.plan).toBe('free');
    expect(entry?.basis?.quantity).toBe('5');
    expect(entry?.basis?.description).toMatch(/送信/);
  });

  it('対象日のデータがない場合は送信数 0 として扱う', async () => {
    const { fetchImpl } = stubFetch({ ...METRICS, data: [] });
    const source = createResendSource(FREE, { fetchImpl });

    const [entry] = (await source.collect('2026-09-08')).costs;

    expect(entry?.basis?.quantity).toBe('0');
  });
});

describe('有料プランの宣言', () => {
  it('月額を対象月の日数で日割りする', async () => {
    const { fetchImpl } = stubFetch(METRICS);
    const source = createResendSource(PAID, { fetchImpl });

    const [entry] = (await source.collect('2026-09-08')).costs;

    // 2026-09 は 30 日。20.00 USD / 30 = 0.666667 USD（6 桁固定）
    expect(entry).toMatchObject({ currency: 'USD', amount: '0.666667' });
    expect(entry?.basis?.daysInMonth).toBe(30);
    expect(entry?.basis?.unitAmount).toBe('20.00');
  });

  it('月の日数に応じて日割り額が変わる', async () => {
    const { fetchImpl } = stubFetch(METRICS);
    const source = createResendSource(PAID, { fetchImpl });

    const [entry] = (await source.collect('2026-02-10')).costs;

    expect(entry?.basis?.daysInMonth).toBe(28);
  });
});

describe('遡及可能期間', () => {
  it('期間内の対象日は取得可能と判定される', () => {
    const source = createResendSource(FREE, {});

    expect(source.canCollect?.('2026-09-08', NOW)).toBe(true);
    expect(source.canCollect?.('2026-08-12', NOW)).toBe(true);
  });

  it('期間外の対象日は取得できないと判定される', () => {
    const source = createResendSource(FREE, {});

    expect(source.canCollect?.('2026-08-10', NOW)).toBe(false);
    expect(source.canCollect?.('2026-07-01', NOW)).toBe(false);
  });
});

describe('取得失敗', () => {
  it('取得に失敗した場合は例外を投げる', async () => {
    const { fetchImpl } = stubFetch({}, false);
    const source = createResendSource(FREE, { fetchImpl });

    await expect(source.collect('2026-09-08')).rejects.toThrow();
  });
});

describe('生応答の保存', () => {
  it('応答を保存対象として返す', async () => {
    const { fetchImpl } = stubFetch(METRICS);
    const source = createResendSource(FREE, { fetchImpl });

    expect((await source.collect('2026-09-08')).raw).toEqual(METRICS);
  });
});
