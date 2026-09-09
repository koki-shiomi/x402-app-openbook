import {
  SCHEMA_VERSION,
  type Correction,
  type DailyRecord,
  type Entry,
  type ExchangeRate,
  type IncompleteItem,
} from './record.js';
import { computeTotals } from './totals.js';

/** レコード生成時に与える内容。集計値とバージョンは生成側が付与する。 */
export interface CreateRecordInput {
  /** 対象日（UTC の暦日、YYYY-MM-DD 形式）。 */
  date: string;
  /** 同一日に対する通し番号（1 始まり）。 */
  revision: number;
  /** レコード生成時刻（UTC、RFC 3339 形式）。 */
  generatedAt: string;
  /** 費用エントリ。 */
  costs?: Entry[];
  /** 収益エントリ。 */
  revenues?: Entry[];
  /** 取得できなかった対象。 */
  incomplete?: IncompleteItem[];
  /** 適用した為替レートの一覧。 */
  exchangeRates?: ExchangeRate[];
  /** 訂正リビジョンの場合の根拠。 */
  correction?: Correction;
}

/**
 * 日次財務レコードを生成する。
 *
 * schemaVersion と集計値は必ずここで付与する。呼び出し側に委ねると、
 * バージョンのないレコードや明細と食い違う集計値が生まれる余地が残るため。
 *
 * @param input レコードの内容
 * @returns 生成した日次財務レコード
 */
export function createRecord(input: CreateRecordInput): DailyRecord {
  const base = {
    schemaVersion: SCHEMA_VERSION,
    date: input.date,
    revision: input.revision,
    costs: input.costs ?? [],
    revenues: input.revenues ?? [],
    incomplete: input.incomplete ?? [],
    exchangeRates: input.exchangeRates ?? [],
    generatedAt: input.generatedAt,
    ...(input.correction === undefined ? {} : { correction: input.correction }),
  };

  return { ...base, totals: computeTotals(base) };
}
