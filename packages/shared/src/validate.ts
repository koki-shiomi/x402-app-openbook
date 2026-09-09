import { isDecimalString } from './decimal.js';
import { CURRENCY_SCALES, type DailyRecord, type Entry } from './record.js';

/** 取得方式として認められる値。 */
const ACQUISITIONS = new Set(['measured', 'derived', 'estimated']);

/**
 * エントリ 1 件を検証する。
 *
 * @param entry 検証対象のエントリ
 * @param path エラーメッセージに含める位置（例: "costs[0]"）
 * @returns 違反内容の配列。妥当なら空配列
 */
function validateEntry(entry: Entry, path: string): string[] {
  const errors: string[] = [];

  if (typeof entry.source !== 'string' || entry.source === '') {
    errors.push(`${path}.source が指定されていません`);
  }
  if (typeof entry.category !== 'string' || entry.category === '') {
    errors.push(`${path}.category が指定されていません`);
  }
  if (!ACQUISITIONS.has(entry.acquisition)) {
    errors.push(`${path}.acquisition が不正です: ${String(entry.acquisition)}`);
  }
  if (typeof entry.revisable !== 'boolean') {
    errors.push(`${path}.revisable が指定されていません`);
  }
  if (!(entry.currency in CURRENCY_SCALES)) {
    errors.push(`${path}.currency が不正です: ${String(entry.currency)}`);
  }
  if (typeof entry.amount !== 'string' || !isDecimalString(entry.amount)) {
    errors.push(`${path}.amount は 10 進小数の文字列である必要があります`);
  }
  if (entry.amountJpy !== undefined && !isDecimalString(entry.amountJpy)) {
    errors.push(`${path}.amountJpy は 10 進小数の文字列である必要があります`);
  }

  return errors;
}

/**
 * 日次財務レコードを検証する。
 *
 * 保存前に必ず呼び出し、違反が 1 件でもあれば保存してはならない。
 *
 * @param record 検証対象のレコード
 * @returns 違反内容の配列。妥当なら空配列
 */
export function validateRecord(record: DailyRecord): string[] {
  const errors: string[] = [];

  if (typeof record.schemaVersion !== 'number') {
    errors.push('schemaVersion が指定されていません');
  }
  if (typeof record.revision !== 'number' || record.revision < 1) {
    errors.push('revision は 1 以上の数値である必要があります');
  }

  record.costs.forEach((entry, index) => {
    errors.push(...validateEntry(entry, `costs[${index}]`));
  });
  record.revenues.forEach((entry, index) => {
    errors.push(...validateEntry(entry, `revenues[${index}]`));
  });

  return errors;
}
