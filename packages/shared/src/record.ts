/**
 * 日次財務レコードの型定義。
 *
 * レコードは確定状態（暫定・確定）を持たない。取得元の多くは値を後から改訂するため、
 * 値の確かさはエントリ単位の取得方式（acquisition）と改訂可能性（revisable）が表す。
 * 詳細は specs/financial-record/spec.md を参照。
 */

/** レコード形式のバージョン。構造や正準表現の規則を変えるときに更新する。 */
export const SCHEMA_VERSION = 1;

/** 通貨ごとに固定する小数桁数。 */
export const CURRENCY_SCALES = {
  JPY: 2,
  USD: 6,
} as const;

/** 対応する通貨コード（ISO 4217）。 */
export type CurrencyCode = keyof typeof CURRENCY_SCALES;

/** 集計基準となる通貨。 */
export const BASE_CURRENCY = 'JPY' satisfies CurrencyCode;

/** 金額がどのように得られたかを表す取得方式。 */
export type Acquisition =
  /** 提供元の API から取得した実際の課金額または収益額。 */
  | 'measured'
  /** 提供元から取得した使用量に、設定した単価を適用して算出した金額。 */
  | 'derived'
  /** 設定した月額プラン費用を対象月の日数で日割りした金額。 */
  | 'estimated';

/** derived / estimated の算出根拠。 */
export interface Basis {
  /** 算出方法の説明（例: "無料プランのため月額 0 円を日割り"）。 */
  description: string;
  /** 適用した単価または月額。 */
  unitAmount?: string;
  /** 日割りの分母となる対象月の日数。 */
  daysInMonth?: number;
  /** 単価を掛ける対象となった使用量。 */
  quantity?: string;
  /** 提供元で確認したプラン名。 */
  plan?: string;
}

/** 費用および収益の 1 明細。 */
export interface Entry {
  /** 提供元の識別子（例: "claude", "cloudflare"）。 */
  source: string;
  /** 費目の識別子（例: "input-tokens"）。 */
  category: string;
  /** 金額の取得方式。 */
  acquisition: Acquisition;
  /** 提供元が後から値を改訂しうるか。 */
  revisable: boolean;
  /** 原通貨コード。 */
  currency: CurrencyCode;
  /** 原通貨での金額（10 進小数の文字列）。 */
  amount: string;
  /** JPY へ換算した金額。換算できなかった場合は持たない。 */
  amountJpy?: string;
  /** 換算に適用した為替レート。原通貨が JPY の場合は持たない。 */
  exchangeRate?: string;
  /** 取得元が集計に用いたタイムゾーン（IANA 名）。UTC 以外のときに差異を明示する。 */
  sourceTimezone?: string;
  /** derived / estimated の場合の算出根拠。 */
  basis?: Basis;
}

/** 取得できなかった対象。0 円のエントリとして記録してはならない。 */
export interface IncompleteItem {
  /** 欠測の種別。 */
  kind: 'source' | 'exchange-rate';
  /** 取得元の識別子、または通貨ペア（例: "USD/JPY"）。 */
  id: string;
  /** 取得できなかった理由。 */
  reason: string;
}

/** 当レコードで適用した為替レート。 */
export interface ExchangeRate {
  /** 通貨ペア（例: "USD/JPY"）。 */
  pair: string;
  /** レート値（10 進小数の文字列）。 */
  rate: string;
  /** レートの提供元。 */
  provider: string;
  /** 提供元がレートを公表した日。休場日は対象日と異なる。 */
  publishedOn: string;
  /** レートを取得した時刻（RFC 3339）。 */
  fetchedAt: string;
}

/** 集計値。すべて JPY 建て。 */
export interface Totals {
  /** 費用合計。 */
  costJpy: string;
  /** 収益合計。 */
  revenueJpy: string;
  /** 損益（収益合計 - 費用合計）。 */
  profitJpy: string;
  /** 欠測を含むため合計が不完全であるか。 */
  incomplete: boolean;
}

/** 訂正リビジョンの根拠。リビジョン 2 以降で必須。 */
export interface Correction {
  /** 置き換え対象のリビジョン番号。 */
  supersedes: number;
  /** 訂正理由。 */
  reason: string;
}

/** 1 暦日分の収益と費用を表す日次財務レコード。 */
export interface DailyRecord {
  /** レコード形式のバージョン識別子。 */
  schemaVersion: number;
  /** 対象日（UTC の暦日、YYYY-MM-DD 形式）。 */
  date: string;
  /** 同一日に対する通し番号（1 始まり）。 */
  revision: number;
  /** 費用エントリ。 */
  costs: Entry[];
  /** 収益エントリ。 */
  revenues: Entry[];
  /** 取得できなかった対象。 */
  incomplete: IncompleteItem[];
  /** 集計値。 */
  totals: Totals;
  /** 適用した為替レートの一覧。 */
  exchangeRates: ExchangeRate[];
  /** レコード生成時刻（UTC、RFC 3339 形式）。 */
  generatedAt: string;
  /** 訂正リビジョンの場合の根拠。 */
  correction?: Correction;
}
