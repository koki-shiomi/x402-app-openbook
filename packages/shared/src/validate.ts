import { isDecimalString } from './decimal.js';
import { computeTotals } from './totals.js';
import { BASE_CURRENCY, CURRENCY_SCALES, type DailyRecord, type Entry } from './record.js';

/** 取得方式として認められる値。 */
const ACQUISITIONS = new Set(['measured', 'derived', 'estimated']);

/** 算出根拠を必須とする取得方式。 */
const ACQUISITIONS_REQUIRING_BASIS = new Set(['derived', 'estimated']);

/** UTC の暦日を表す形式。 */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * UTC の暦日として実在する日付かを判定する。
 *
 * 形式が正しくても 2026-02-30 のように存在しない日付は拒否する。
 *
 * @param date 判定対象の文字列
 * @returns 実在する暦日なら true
 */
export function isCalendarDate(date: string): boolean {
  if (!DATE_PATTERN.test(date)) {
    return false;
  }

  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

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

  // 公開値のうちどれが推定かを利用者が判別できるよう、算出根拠の有無を取得方式と対応させる。
  const requiresBasis = ACQUISITIONS_REQUIRING_BASIS.has(entry.acquisition);
  if (requiresBasis && entry.basis === undefined) {
    errors.push(`${path}.basis は ${entry.acquisition} では必須です`);
  }
  if (!requiresBasis && entry.basis !== undefined) {
    errors.push(`${path}.basis は ${entry.acquisition} では指定できません`);
  }

  if (entry.currency === BASE_CURRENCY) {
    if (entry.exchangeRate !== undefined) {
      errors.push(`${path}.exchangeRate は ${BASE_CURRENCY} 建てでは指定できません`);
    }
    if (entry.amountJpy !== undefined && entry.amountJpy !== entry.amount) {
      errors.push(`${path}.amountJpy は ${BASE_CURRENCY} 建てでは原金額と一致する必要があります`);
    }
  } else if (entry.amountJpy !== undefined && entry.exchangeRate === undefined) {
    errors.push(`${path}.exchangeRate は換算値を持つ外貨建てエントリでは必須です`);
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
  if (typeof record.date !== 'string' || !isCalendarDate(record.date)) {
    errors.push(`date は実在する UTC 暦日である必要があります: ${String(record.date)}`);
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

  // 明細と集計値が食い違ったまま公開されないよう、保存前に必ず突き合わせる。
  if (errors.length === 0) {
    const expected = computeTotals(record);
    for (const key of ['costJpy', 'revenueJpy', 'profitJpy', 'incomplete'] as const) {
      if (record.totals[key] !== expected[key]) {
        errors.push(
          `totals.${key} が明細から再計算した値と一致しません: ` +
            `${String(record.totals[key])} != ${String(expected[key])}`,
        );
      }
    }
  }

  return errors;
}
