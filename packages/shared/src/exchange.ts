import { multiplyDecimals, roundHalfUp } from './decimal.js';
import { BASE_CURRENCY, CURRENCY_SCALES, type Entry, type ExchangeRate } from './record.js';

/** レートの提供元識別子。 */
const PROVIDER = 'frankfurter';

/** 対応する通貨ペア。 */
const PAIR = 'USD/JPY';

/** Frankfurter の応答形式。 */
interface FrankfurterResponse {
  /** レートが実際に公表された日。休場日を指定すると直近営業日が返る。 */
  date: string;
  /** 通貨コードごとのレート。 */
  rates: Record<string, number>;
}

/** レート取得の依存。テストから差し替えられるようにする。 */
export interface FetchRateOptions {
  /** HTTP 取得に用いる関数。 */
  fetchImpl?: typeof fetch;
  /** 取得時刻として記録する値（RFC 3339）。 */
  now: string;
}

/**
 * 対象日の USD/JPY レートを取得する。
 *
 * ECB は営業日のみレートを公表するため、休場日を指定した場合は対象日以前で
 * 最新の公表日のレートが返る。適用したレートの公表日は対象日とは別に記録する。
 *
 * @param date 対象日（UTC の暦日、YYYY-MM-DD 形式）
 * @param options 取得の依存
 * @returns 取得したレート
 * @throws {Error} 取得に失敗した場合。過去に取得したレートを流用してはならない
 */
export async function fetchUsdJpyRate(
  date: string,
  options: FetchRateOptions,
): Promise<ExchangeRate> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = `https://api.frankfurter.dev/v1/${date}?base=USD&symbols=JPY`;
  const response = await fetchImpl(url);

  if (!response.ok) {
    throw new Error(`為替レートの取得に失敗しました: HTTP ${response.status}`);
  }

  const body = (await response.json()) as FrankfurterResponse;
  const rate = body.rates?.['JPY'];

  if (typeof rate !== 'number' || !Number.isFinite(rate)) {
    throw new Error('為替レートの応答に JPY のレートが含まれていません');
  }

  return {
    pair: PAIR,
    rate: String(rate),
    provider: PROVIDER,
    publishedOn: body.date,
    fetchedAt: options.now,
  };
}

/**
 * エントリの金額を JPY へ換算する。
 *
 * 原通貨・原金額・適用レートを残したまま換算値を加えるため、公開されたレコード
 * だけから換算を再計算できる。丸めは個々のエントリに対して行う。
 *
 * @param entry 換算対象のエントリ
 * @param rate 適用するレート。取得できなかった場合は undefined
 * @returns 換算値を加えたエントリ。換算できない場合は換算値を持たない
 */
export function convertToJpy(entry: Entry, rate: ExchangeRate | undefined): Entry {
  if (entry.currency === BASE_CURRENCY) {
    return { ...entry, amountJpy: entry.amount };
  }

  if (rate === undefined) {
    return entry;
  }

  return {
    ...entry,
    exchangeRate: rate.rate,
    amountJpy: roundHalfUp(multiplyDecimals(entry.amount, rate.rate), CURRENCY_SCALES.JPY),
  };
}
