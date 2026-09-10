import { describe, expect, it } from 'vitest';

import { validateRecord } from './validate.js';
import { buildRecord } from './test-fixtures.js';
import type { DailyRecord } from './record.js';

/** 違反メッセージの中に指定の語を含むものがあるか。 */
function hasError(record: DailyRecord, fragment: string): boolean {
  return validateRecord(record).some((message) => message.includes(fragment));
}

/**
 * 「小数桁数は通貨ごとに固定し、JPY は 2 桁、USD は 6 桁とする」という規定を検証する。
 * 仕様本文にはこの規定があるが Scenario がなく、桁数違反が検証を素通りしていた。
 */
describe('原金額の小数桁数', () => {
  it.each(['0.01007', '0.0100710', '0.01', '1'])(
    'USD 建てで 6 桁でない %s を拒否する',
    (amount) => {
      const record = buildRecord();
      record.costs[0]!.amount = amount;

      expect(hasError(record, 'amount')).toBe(true);
    },
  );

  it('USD 建てで 6 桁の値を受け入れる', () => {
    const record = buildRecord();
    record.costs[0]!.amount = '0.012345';

    expect(hasError(record, 'costs[0].amount')).toBe(false);
  });

  it.each(['12', '12.0', '12.000'])('JPY 建てで 2 桁でない %s を拒否する', (amount) => {
    const record = buildRecord();
    record.revenues[0]!.amount = amount;
    record.revenues[0]!.amountJpy = amount;

    expect(hasError(record, 'amount')).toBe(true);
  });

  it('JPY 建てで 2 桁の値を受け入れる', () => {
    expect(validateRecord(buildRecord())).toEqual([]);
  });
});

describe('JPY 換算額の小数桁数', () => {
  it.each(['1.4', '1.480', '1'])('2 桁でない %s を拒否する', (amountJpy) => {
    const record = buildRecord();
    record.costs[0]!.amountJpy = amountJpy;

    expect(hasError(record, 'amountJpy')).toBe(true);
  });

  it('換算額を持たないエントリは桁数を検証しない', () => {
    const record = buildRecord();
    delete record.costs[0]!.amountJpy;
    delete record.costs[0]!.exchangeRate;
    record.totals = { costJpy: '0.00', revenueJpy: '12.00', profitJpy: '12.00', incomplete: false };

    expect(hasError(record, 'amountJpy')).toBe(false);
  });
});

describe('集計値の小数桁数', () => {
  it.each(['costJpy', 'revenueJpy', 'profitJpy'] as const)(
    '%s が 2 桁でなければ拒否する',
    (key) => {
      const record = buildRecord();
      record.totals[key] = '1.4';

      expect(hasError(record, `totals.${key}`)).toBe(true);
    },
  );
});

describe('桁数の規定がない項目', () => {
  it('為替レートの桁数は検証しない', () => {
    const record = buildRecord();
    record.exchangeRates[0]!.rate = '147.2';
    record.costs[0]!.exchangeRate = '147.2';

    expect(hasError(record, 'rate')).toBe(false);
  });
});
