import { compareDecimals, multiplyDecimals, subtractDecimals } from './decimal.js';

/**
 * 収集と訂正の方針を定める値。
 *
 * 値を変えると公開データのリビジョンの増え方が変わるため、コードおよびテストと
 * 同時に変更できるよう定数として持ち、変更はデプロイで反映する。
 * 詳細は specs/daily-batch/spec.md を参照。
 */

/** 訂正リビジョンを追加せずに見送る、金額の変化の上限。 */
export const REVISION_THRESHOLD = {
  /** 差の絶対値の上限（JPY）。 */
  maxDifference: '1',
  /** 既存の値に対する差の比率の上限。 */
  maxRatio: '0.01',
} as const;

/** 日次実行のたびに再収集する、実行時点から遡る日数。 */
export const RECOLLECTION_DAYS = 40;

/**
 * 10 進小数の絶対値を求める。
 *
 * @param value 対象の 10 進小数の文字列
 * @returns 符号を取り除いた 10 進小数の文字列
 */
function absolute(value: string): string {
  return value.startsWith('-') ? value.slice(1) : value;
}

/**
 * 金額の変化が、訂正リビジョンを見送る閾値に収まるかを判定する。
 *
 * 既存の値が 0 の場合、比率は定義できない。0 から値が現れることは収益や費用が
 * 発生したという情報そのものであるため、比率の条件を満たさないものとして扱う。
 *
 * 比率は除算による丸めを避けるため、差と「既存の値 × 上限比率」を比較して判定する。
 *
 * @param existing 既存の最新リビジョンの値（10 進小数の文字列）
 * @param next 今回生成した値（10 進小数の文字列）
 * @returns 閾値に収まり、訂正リビジョンを見送ってよい場合は true
 */
export function isWithinRevisionThreshold(existing: string, next: string): boolean {
  const difference = absolute(subtractDecimals(next, existing));
  if (compareDecimals(difference, '0') === 0) {
    return true;
  }

  if (compareDecimals(difference, REVISION_THRESHOLD.maxDifference) > 0) {
    return false;
  }

  const base = absolute(existing);
  if (compareDecimals(base, '0') === 0) {
    return false;
  }

  return compareDecimals(difference, multiplyDecimals(REVISION_THRESHOLD.maxRatio, base)) <= 0;
}
