import { describe, expect, it } from 'vitest';

import { createRecord } from './create.js';
import { SCHEMA_VERSION } from './record.js';
import { validateRecord } from './validate.js';

describe('createRecord', () => {
  it('現行の schemaVersion を必ず付与する', () => {
    const record = createRecord({
      date: '2026-09-07',
      revision: 1,
      generatedAt: '2026-09-08T06:00:00Z',
    });

    expect(record.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('明細を与えない場合は空のレコードになり集計値は 0 になる', () => {
    const record = createRecord({
      date: '2026-09-07',
      revision: 1,
      generatedAt: '2026-09-08T06:00:00Z',
    });

    expect(record.costs).toEqual([]);
    expect(record.revenues).toEqual([]);
    expect(record.incomplete).toEqual([]);
    expect(record.totals).toEqual({
      costJpy: '0.00',
      revenueJpy: '0.00',
      profitJpy: '0.00',
      incomplete: false,
    });
    expect(validateRecord(record)).toEqual([]);
  });

  it('集計値は与えられた明細から算出される', () => {
    const record = createRecord({
      date: '2026-09-07',
      revision: 1,
      generatedAt: '2026-09-08T06:00:00Z',
      revenues: [
        {
          source: 'admob',
          category: 'estimated-earnings',
          acquisition: 'measured',
          revisable: true,
          currency: 'JPY',
          amount: '12.00',
          amountJpy: '12.00',
        },
      ],
    });

    expect(record.totals.revenueJpy).toBe('12.00');
    expect(record.totals.profitJpy).toBe('12.00');
    expect(validateRecord(record)).toEqual([]);
  });
});
