import { describe, expect, it } from 'vitest';

import { computeTotals, recordIncomplete } from './totals.js';
import { validateRecord } from './validate.js';
import { buildRecord } from './test-fixtures.js';
import type { Entry, IncompleteItem } from './record.js';

describe('recordIncomplete', () => {
  it('取得失敗した対象を理由とともに記録し、0 円のエントリを追加しない', () => {
    const record = buildRecord({ costs: [], incomplete: [] });

    const updated = recordIncomplete(record, {
      kind: 'source',
      id: 'supabase',
      reason: 'HTTP 503',
    });

    expect(updated.incomplete).toEqual<IncompleteItem[]>([
      { kind: 'source', id: 'supabase', reason: 'HTTP 503' },
    ]);
    expect(updated.costs).toEqual([]);
  });

  it('欠測がない場合 incomplete は空配列のままである', () => {
    expect(buildRecord().incomplete).toEqual([]);
  });

  it('無料プランによる 0 円は estimated として記録され欠測にはならない', () => {
    const freeTier: Entry = {
      source: 'supabase',
      category: 'plan',
      acquisition: 'estimated',
      revisable: false,
      currency: 'JPY',
      amount: '0.00',
      amountJpy: '0.00',
      basis: { description: '無料プランのため月額 0 円を日割り', plan: 'free' },
    };
    const base = buildRecord({ costs: [freeTier], revenues: [], incomplete: [] });
    const record = { ...base, totals: computeTotals(base) };

    expect(validateRecord(record)).toEqual([]);
    expect(record.incomplete).toEqual([]);
    expect(record.totals.costJpy).toBe('0.00');
  });
});

describe('computeTotals', () => {
  it('丸め後の各エントリの合計と一致する', () => {
    const totals = computeTotals(buildRecord());

    expect(totals).toEqual({
      costJpy: '1.48',
      revenueJpy: '12.00',
      profitJpy: '10.52',
      incomplete: false,
    });
  });

  it('欠測があるとき incomplete を真にする', () => {
    const record = buildRecord({
      incomplete: [{ kind: 'source', id: 'supabase', reason: 'HTTP 503' }],
    });

    expect(computeTotals(record).incomplete).toBe(true);
  });

  it('換算値を持たないエントリは合計に含めない', () => {
    const record = buildRecord();
    delete record.costs[0]!.amountJpy;
    delete record.costs[0]!.exchangeRate;

    expect(computeTotals(record).costJpy).toBe('0.00');
  });
});

describe('集計値の整合性検証', () => {
  it('明細と一致する totals を受け入れる', () => {
    expect(validateRecord(buildRecord())).toEqual([]);
  });

  it('費用合計が明細と一致しないレコードを拒否する', () => {
    const record = buildRecord();
    record.totals.costJpy = '999.00';

    expect(validateRecord(record).some((m) => m.includes('totals'))).toBe(true);
  });

  it('欠測があるのに totals.incomplete が偽なら拒否する', () => {
    const record = buildRecord({
      incomplete: [{ kind: 'source', id: 'supabase', reason: 'HTTP 503' }],
    });

    expect(validateRecord(record).some((m) => m.includes('totals'))).toBe(true);
  });
});
