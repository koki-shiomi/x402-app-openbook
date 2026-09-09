import { SCHEMA_VERSION, type DailyRecord } from './record.js';

/**
 * テスト用の妥当な日次財務レコードを組み立てる。
 *
 * 各テストが必要な箇所だけを壊して検証できるよう、既定では全項目が妥当な状態にする。
 *
 * @param overrides 上書きしたい項目
 * @returns 日次財務レコード
 */
export function buildRecord(overrides: Partial<DailyRecord> = {}): DailyRecord {
  return {
    schemaVersion: SCHEMA_VERSION,
    date: '2026-09-07',
    revision: 1,
    costs: [
      {
        source: 'claude',
        category: 'input-tokens',
        acquisition: 'measured',
        revisable: false,
        currency: 'USD',
        amount: '0.010071',
        amountJpy: '1.48',
        exchangeRate: '147.25',
      },
    ],
    revenues: [
      {
        source: 'admob',
        category: 'estimated-earnings',
        acquisition: 'measured',
        revisable: true,
        currency: 'JPY',
        amount: '12.00',
        amountJpy: '12.00',
        sourceTimezone: 'America/Los_Angeles',
      },
    ],
    incomplete: [],
    totals: {
      costJpy: '1.48',
      revenueJpy: '12.00',
      profitJpy: '10.52',
      incomplete: false,
    },
    exchangeRates: [
      {
        pair: 'USD/JPY',
        rate: '147.25',
        provider: 'frankfurter',
        publishedOn: '2026-09-07',
        fetchedAt: '2026-09-08T06:00:00Z',
      },
    ],
    generatedAt: '2026-09-08T06:00:00Z',
    ...overrides,
  };
}
