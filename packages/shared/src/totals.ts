import { addDecimals, roundHalfUp, subtractDecimals } from './decimal.js';
import {
  CURRENCY_SCALES,
  type DailyRecord,
  type Entry,
  type IncompleteItem,
  type Totals,
} from './record.js';

/** 集計基準通貨の小数桁数。 */
const BASE_SCALE = CURRENCY_SCALES.JPY;

/**
 * 換算済みの金額だけを取り出す。
 *
 * 換算できなかったエントリは合計に含めない。0 円として扱うと、
 * 換算できなかった事実が合計に埋もれてしまう。
 *
 * @param entries 対象のエントリ配列
 * @returns JPY 換算済み金額の配列
 */
function convertedAmounts(entries: readonly Entry[]): string[] {
  return entries
    .map((entry) => entry.amountJpy)
    .filter((amount): amount is string => amount !== undefined);
}

/** 集計に必要な最小限の内容。 */
export interface TotalsInput {
  costs: readonly Entry[];
  revenues: readonly Entry[];
  incomplete: readonly IncompleteItem[];
}

/**
 * レコードの明細から集計値を算出する。
 *
 * 丸めは個々のエントリに対して既に適用されている前提で、丸め後の値を合計する。
 * 丸め前の値から合計すると、公開された明細の合計と集計値が一致しなくなる。
 *
 * @param record 集計対象のレコード
 * @returns 算出した集計値
 */
export function computeTotals(record: TotalsInput): Totals {
  const costJpy = roundHalfUp(addDecimals(convertedAmounts(record.costs)), BASE_SCALE);
  const revenueJpy = roundHalfUp(
    addDecimals(convertedAmounts(record.revenues)),
    BASE_SCALE,
  );

  return {
    costJpy,
    revenueJpy,
    profitJpy: subtractDecimals(revenueJpy, costJpy),
    incomplete: record.incomplete.length > 0,
  };
}

/**
 * 取得できなかった対象をレコードへ記録する。
 *
 * 金額 0 のエントリは追加しない。無料プランのため実際に 0 円である場合とは
 * 区別する必要があるため（後者は月額 0 円の estimated として記録する）。
 *
 * @param record 対象のレコード
 * @param item 記録する欠測
 * @returns 欠測と集計値を更新した新しいレコード
 */
export function recordIncomplete(record: DailyRecord, item: IncompleteItem): DailyRecord {
  const updated: DailyRecord = {
    ...record,
    incomplete: [...record.incomplete, item],
  };

  return { ...updated, totals: computeTotals(updated) };
}
