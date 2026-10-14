import { describe, expect, it } from 'vitest';

import { validateRecord } from '../src/validate.js';
import { buildRecord } from './test-fixtures.js';
import type { DailyRecord, Entry } from '../src/record.js';

/** 違反メッセージの中に指定の語を含むものがあるか。 */
function hasError(record: DailyRecord, fragment: string): boolean {
  return validateRecord(record).some((message) => message.includes(fragment));
}

describe('日付の検証', () => {
  it.each(['2026-9-7', '20260907', '2026-09-07T00:00:00Z', 'yesterday'])(
    '%s を形式不正として拒否する',
    (date) => {
      expect(hasError(buildRecord({ date }), 'date')).toBe(true);
    },
  );

  it('実在しない日付を拒否する', () => {
    expect(hasError(buildRecord({ date: '2026-02-30' }), 'date')).toBe(true);
  });

  it('実在する日付を受け入れる', () => {
    expect(hasError(buildRecord({ date: '2026-02-28' }), 'date')).toBe(false);
  });
});

describe('通貨コードの検証', () => {
  it('対応していない通貨コードを拒否する', () => {
    const record = buildRecord();
    (record.costs[0] as unknown as { currency: string }).currency = 'EUR';

    expect(hasError(record, 'currency')).toBe(true);
  });
});

describe('算出根拠の検証', () => {
  it('estimated に算出根拠がなければ拒否する', () => {
    const record = buildRecord();
    record.costs[0]!.acquisition = 'estimated';

    expect(hasError(record, 'basis')).toBe(true);
  });

  it('derived に算出根拠がなければ拒否する', () => {
    const record = buildRecord();
    record.costs[0]!.acquisition = 'derived';

    expect(hasError(record, 'basis')).toBe(true);
  });

  it('measured に算出根拠が付いていれば拒否する', () => {
    const record = buildRecord();
    record.costs[0]!.basis = { description: '不要な根拠' };

    expect(hasError(record, 'basis')).toBe(true);
  });

  it('estimated に算出根拠があれば受け入れる', () => {
    const record = buildRecord();
    const entry: Entry = {
      ...record.costs[0]!,
      acquisition: 'estimated',
      basis: { description: '無料プランのため月額 0 円を日割り', plan: 'free' },
    };

    expect(hasError(buildRecord({ costs: [entry] }), 'basis')).toBe(false);
  });
});

describe('換算の検証', () => {
  it('外貨建てで換算値があるのにレートがなければ拒否する', () => {
    const record = buildRecord();
    delete record.costs[0]!.exchangeRate;

    expect(hasError(record, 'exchangeRate')).toBe(true);
  });

  it('JPY 建ては換算値が原金額と一致しなければ拒否する', () => {
    const record = buildRecord();
    record.revenues[0]!.amountJpy = '99.00';

    expect(hasError(record, 'amountJpy')).toBe(true);
  });
});
