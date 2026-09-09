import { describe, expect, expectTypeOf, it } from 'vitest';

import { validateRecord } from './validate.js';
import { SCHEMA_VERSION, type DailyRecord, type Entry } from './record.js';
import { buildRecord } from './test-fixtures.js';

describe('レコードの型', () => {
  it('確定状態を表すフィールドを持たない', () => {
    expectTypeOf<DailyRecord>().not.toHaveProperty('status');
  });

  it('金額は文字列で表現される', () => {
    expectTypeOf<Entry['amount']>().toEqualTypeOf<string>();
    expectTypeOf<Entry['amountJpy']>().toEqualTypeOf<string | undefined>();
  });

  it('取得方式と改訂可能性は省略できない', () => {
    expectTypeOf<Entry['acquisition']>().not.toEqualTypeOf<undefined>();
    expectTypeOf<Entry['revisable']>().toEqualTypeOf<boolean>();
  });
});

describe('validateRecord', () => {
  it('妥当なレコードを受け入れる', () => {
    expect(validateRecord(buildRecord())).toEqual([]);
  });

  it('取得方式が欠けたエントリを拒否する', () => {
    const record = buildRecord();
    delete (record.costs[0] as Partial<Entry>).acquisition;

    expect(validateRecord(record)).toContainEqual(
      expect.stringContaining('acquisition'),
    );
  });

  it('改訂可能性が欠けたエントリを拒否する', () => {
    const record = buildRecord();
    delete (record.costs[0] as Partial<Entry>).revisable;

    expect(validateRecord(record)).toContainEqual(expect.stringContaining('revisable'));
  });

  it('金額が数値型のエントリを拒否する', () => {
    const record = buildRecord();
    (record.costs[0] as unknown as { amount: number }).amount = 1.5;

    expect(validateRecord(record)).toContainEqual(expect.stringContaining('amount'));
  });

  it('schemaVersion を持たないレコードを拒否する', () => {
    const record = buildRecord();
    delete (record as Partial<DailyRecord>).schemaVersion;

    expect(validateRecord(record)).toContainEqual(
      expect.stringContaining('schemaVersion'),
    );
  });

  it('生成したレコードには現行の schemaVersion が付与される', () => {
    expect(buildRecord().schemaVersion).toBe(SCHEMA_VERSION);
  });
});
