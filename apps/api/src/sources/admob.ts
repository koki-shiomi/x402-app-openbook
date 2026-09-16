import {
  CURRENCY_SCALES,
  multiplyDecimals,
  roundHalfUp,
  type CurrencyCode,
  type Entry,
} from '@openbook/shared';

import type { CollectionResult, CollectionSource } from '../batch.js';
import type { AdmobConfig } from './config.js';

/**
 * AdMob の収益収集。
 *
 * 取得できるのは推定収益のみで、確定額を返す API がない。推定値は出現から
 * 最初の 48 時間は頻繁に変動するため、改訂可能性を真として記録する。詳細は
 * specs/revenue-collection/spec.md を参照。
 *
 * 日の区切りはアカウントのレポートタイムゾーンであり、レコードの対象日
 * （UTC 暦日）とはずれる。按分せず、タイムゾーンをエントリに記録して明示する。
 */

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const API_BASE = 'https://admob.googleapis.com/v1';

/** アクセストークンを使い回す際に、有効期限の手前に置く余裕（ミリ秒）。 */
const EXPIRY_MARGIN_MS = 60_000;

/** パブリッシャーアカウントの情報。 */
interface PublisherAccount {
  reportingTimeZone: string;
  currencyCode: string;
}

/** レポートの 1 行。 */
interface ReportRow {
  dimensionValues?: Record<string, { value?: string }>;
  metricValues?: Record<string, { microsValue?: string }>;
}

/** レポート応答の 1 メッセージ。ヘッダ・行・フッタのいずれかを持つ。 */
interface ReportMessage {
  header?: { localizationSettings?: { currencyCode?: string } };
  row?: ReportRow;
  footer?: { matchingRowCount?: string };
}

/** AdMob 収集ソースの依存。 */
export interface AdmobSourceOptions {
  fetchImpl?: typeof fetch;
}

/**
 * 対象日を AdMob の日付表現へ変換する。
 *
 * @param date 対象日（YYYY-MM-DD 形式）
 * @returns 年・月・日の数値
 * @throws {Error} 日付の形式が不正な場合
 */
function toReportDate(date: string): { year: number; month: number; day: number } {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (matched === null) {
    throw new Error(`対象日の形式が不正です: ${date}`);
  }

  return {
    year: Number(matched[1]),
    month: Number(matched[2]),
    day: Number(matched[3]),
  };
}

/**
 * マイクロ単位の金額を、通貨の小数桁数へ丸めた 10 進小数へ変換する。
 *
 * 浮動小数点数を経由すると、丸めの境界にある値が 1 桁下へ落ちることがあるため、
 * 10 進小数の文字列のまま計算する。
 *
 * @param micros マイクロ単位（100 万分の 1）の金額
 * @param scale 通貨の小数桁数
 * @returns 10 進小数の文字列
 */
function microsToDecimal(micros: string, scale: number): string {
  return roundHalfUp(multiplyDecimals(micros, '0.000001'), scale);
}

/**
 * AdMob の収益を取得する収集ソースを作る。
 *
 * @param config AdMob の設定
 * @param options 依存
 * @returns 収集ソース
 */
export function createAdmobSource(
  config: AdmobConfig,
  options: AdmobSourceOptions = {},
): CollectionSource {
  const fetchImpl = options.fetchImpl ?? fetch;
  // 1 回の日次実行で当月内の各日が再収集されるため、トークンはソース内で使い回す。
  let cached: { accessToken: string; expiresAt: number } | undefined;

  /**
   * リフレッシュトークンからアクセストークンを得る。有効なものがあれば使い回す。
   *
   * @returns アクセストークン
   * @throws {Error} 取得に失敗した場合
   */
  async function getAccessToken(): Promise<string> {
    if (cached !== undefined && Date.now() < cached.expiresAt) {
      return cached.accessToken;
    }

    const response = await fetchImpl(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: config.refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (body.error === 'invalid_grant') {
        throw new Error(
          'リフレッシュトークンが失効または取り消されています。トークンの再発行が必要です',
        );
      }
      throw new Error(`アクセストークンの取得に失敗しました: HTTP ${response.status}`);
    }

    const body = (await response.json()) as { access_token: string; expires_in?: number };
    const lifetimeMs = (body.expires_in ?? 0) * 1000;
    cached = {
      accessToken: body.access_token,
      expiresAt: Date.now() + Math.max(lifetimeMs - EXPIRY_MARGIN_MS, 0),
    };

    return body.access_token;
  }

  /**
   * AdMob API を呼び出す。
   *
   * @param path アカウント配下のパス
   * @param body POST する本文。省略すると GET になる
   * @returns 応答本文
   * @throws {Error} 取得に失敗した場合
   */
  async function callApi<T>(path: string, body?: unknown): Promise<T> {
    const accessToken = await getAccessToken();
    const url = `${API_BASE}/accounts/${config.publisherId}${path}`;
    const response = await fetchImpl(url, {
      ...(body === undefined
        ? {}
        : { method: 'POST', body: JSON.stringify(body) }),
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`AdMob の取得に失敗しました (${path}): HTTP ${response.status}`);
    }

    return (await response.json()) as T;
  }

  return {
    id: 'admob',
    revisable: true,
    // 収益レポートを 1 回取得する。
    requestsPerCollection: 1,
    // アクセストークンは実行の中で使い回すため、実行ごとに 1 回だけ取得する。
    requestsPerRun: 1,

    async collect(date: string): Promise<CollectionResult> {
      const account = await callApi<PublisherAccount>('');
      const reportDate = toReportDate(date);
      const report = await callApi<ReportMessage[]>('/networkReport:generate', {
        reportSpec: {
          dateRange: { startDate: reportDate, endDate: reportDate },
          dimensions: ['DATE', 'FORMAT'],
          metrics: ['ESTIMATED_EARNINGS'],
          dimensionFilters: [
            { dimension: 'APP', matchesAny: { values: [config.appId] } },
          ],
        },
      });

      const headerCurrency = report.find((message) => message.header !== undefined)?.header
        ?.localizationSettings?.currencyCode;
      if (headerCurrency !== account.currencyCode) {
        throw new Error(
          `レポートの通貨 ${String(headerCurrency)} がアカウントの通貨 ${account.currencyCode} と一致しません`,
        );
      }

      const currency = account.currencyCode as CurrencyCode;
      const scale = CURRENCY_SCALES[currency] as number | undefined;
      if (scale === undefined) {
        throw new Error(
          `小数桁数を定義していない通貨のため記録できません: ${account.currencyCode}`,
        );
      }

      const revenues: Entry[] = report
        .filter((message) => message.row !== undefined)
        .map((message) => {
          const row = message.row!;
          const format = row.dimensionValues?.['FORMAT']?.value;
          const micros = row.metricValues?.['ESTIMATED_EARNINGS']?.microsValue;
          if (format === undefined || micros === undefined) {
            throw new Error('レポートの行に広告フォーマットまたは推定収益がありません');
          }

          return {
            source: 'admob',
            category: format,
            acquisition: 'measured' as const,
            revisable: true,
            currency,
            amount: microsToDecimal(micros, scale),
            sourceTimezone: account.reportingTimeZone,
          };
        });

      return { costs: [], revenues, raw: { account, report } };
    },
  };
}
