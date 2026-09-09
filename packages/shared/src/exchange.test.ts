import { describe, expect, it, vi } from 'vitest';

import { convertToJpy, fetchUsdJpyRate } from './exchange.js';
import type { Entry, ExchangeRate } from './record.js';

/** Frankfurter の応答を模したフェッチ関数を作る。 */
function stubFetch(body: unknown, ok = true): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), { status: ok ? 200 : 503 }),
  ) as unknown as typeof fetch;
}

const RATE: ExchangeRate = {
  pair: 'USD/JPY',
  rate: '147.25',
  provider: 'frankfurter',
  publishedOn: '2026-09-07',
  fetchedAt: '2026-09-08T06:00:00Z',
};

describe('fetchUsdJpyRate', () => {
  it('レート値と公表日を取得する', async () => {
    const fetchImpl = stubFetch({
      amount: 1,
      base: 'USD',
      date: '2026-09-07',
      rates: { JPY: 147.25 },
    });

    const result = await fetchUsdJpyRate('2026-09-07', {
      fetchImpl,
      now: '2026-09-08T06:00:00Z',
    });

    expect(result).toEqual({
      pair: 'USD/JPY',
      rate: '147.25',
      provider: 'frankfurter',
      publishedOn: '2026-09-07',
      fetchedAt: '2026-09-08T06:00:00Z',
    });
  });

  it('市場休場日は直近公表日のレートが適用され、その公表日が記録される', async () => {
    const fetchImpl = stubFetch({
      amount: 1,
      base: 'USD',
      date: '2026-09-04',
      rates: { JPY: 146.8 },
    });

    const result = await fetchUsdJpyRate('2026-09-06', {
      fetchImpl,
      now: '2026-09-08T06:00:00Z',
    });

    expect(result.publishedOn).toBe('2026-09-04');
    expect(result.rate).toBe('146.8');
  });

  it('取得に失敗した場合は例外を投げる', async () => {
    const fetchImpl = stubFetch({}, false);

    await expect(
      fetchUsdJpyRate('2026-09-07', { fetchImpl, now: '2026-09-08T06:00:00Z' }),
    ).rejects.toThrow();
  });
});

describe('convertToJpy', () => {
  const usdEntry: Entry = {
    source: 'claude',
    category: 'input-tokens',
    acquisition: 'measured',
    revisable: false,
    currency: 'USD',
    amount: '0.010071',
  };

  it('原通貨・原金額・適用レート・換算後金額をすべて保持する', () => {
    const converted = convertToJpy(usdEntry, RATE);

    expect(converted.currency).toBe('USD');
    expect(converted.amount).toBe('0.010071');
    expect(converted.exchangeRate).toBe('147.25');
    expect(converted.amountJpy).toBe('1.48');
  });

  it('同一レコード内の複数エントリに同一レートが適用される', () => {
    const other: Entry = { ...usdEntry, category: 'output-tokens', amount: '0.00189' };

    const converted = [usdEntry, other].map((entry) => convertToJpy(entry, RATE));

    expect(new Set(converted.map((entry) => entry.exchangeRate)).size).toBe(1);
  });

  it('JPY 建ては換算せず原金額をそのまま用いる', () => {
    const jpyEntry: Entry = { ...usdEntry, currency: 'JPY', amount: '12.00' };

    const converted = convertToJpy(jpyEntry, RATE);

    expect(converted.amountJpy).toBe('12.00');
    expect(converted.exchangeRate).toBeUndefined();
  });

  it('レートがない場合は換算値を持たない', () => {
    const converted = convertToJpy(usdEntry, undefined);

    expect(converted.amountJpy).toBeUndefined();
    expect(converted.exchangeRate).toBeUndefined();
  });
});

describe('レート取得失敗時の扱い', () => {
  it('当該通貨ペアが incomplete へ記録され、換算値を持たない', async () => {
    const { recordIncomplete } = await import('./totals.js');
    const { buildRecord } = await import('./test-fixtures.js');

    const unconverted = convertToJpy(
      {
        source: 'claude',
        category: 'input-tokens',
        acquisition: 'measured',
        revisable: false,
        currency: 'USD',
        amount: '0.010071',
      },
      undefined,
    );
    const base = buildRecord({ costs: [unconverted], revenues: [], exchangeRates: [] });

    const updated = recordIncomplete(base, {
      kind: 'exchange-rate',
      id: 'USD/JPY',
      reason: 'HTTP 503',
    });

    expect(updated.incomplete).toEqual([
      { kind: 'exchange-rate', id: 'USD/JPY', reason: 'HTTP 503' },
    ]);
    expect(updated.costs[0]?.amountJpy).toBeUndefined();
    expect(updated.totals.incomplete).toBe(true);
    expect(updated.totals.costJpy).toBe('0.00');
  });

  it('過去に取得したレートを流用しない', async () => {
    const previous: ExchangeRate = { ...RATE, publishedOn: '2026-09-01' };
    const fetchImpl = stubFetch({}, false);

    await expect(
      fetchUsdJpyRate('2026-09-07', { fetchImpl, now: '2026-09-08T06:00:00Z' }),
    ).rejects.toThrow();

    // 失敗時は例外となり、直近の取得結果が返ることはない。
    expect(previous.publishedOn).toBe('2026-09-01');
  });
});
