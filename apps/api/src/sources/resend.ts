import { CURRENCY_SCALES, divideDecimals, roundHalfUp, type Entry } from '@openbook/shared';

import type { CollectionResult, CollectionSource } from '../batch.js';
import type { ResendConfig } from './config.js';

/**
 * Resend の費用収集。
 *
 * 課金額を返す API がなく、プラン判定に使えるヘッダは送信時のレスポンスにしか
 * 付かない。費用確認のためにメールを送るのは目的に反するため、プランは設定値
 * として宣言し、日別送信数を併記して判断材料とする。詳細は
 * specs/cost-collection/spec.md の「Resend 費用のプラン宣言による記録」を参照。
 */

const METRICS_ENDPOINT = 'https://api.resend.com/emails/metrics';

/**
 * 遡及可能な日数。
 *
 * 実測では約 30 日を超える指定が直近の日付へ切り詰められた。正確な境界を
 * 確認できていないため、切り詰めが起きない側へ 1 日の余裕を持たせる。
 * 切り詰められた値を対象日の値として記録すると誤ったデータが公開される。
 */
const REACHABLE_DAYS = 29;

/** metrics の日別行。 */
interface MetricsRow {
  period: string;
  sent?: number;
}

/** Resend 収集ソースの依存。 */
export interface ResendSourceOptions {
  fetchImpl?: typeof fetch;
}

/**
 * 対象月の日数を求める。
 *
 * @param date 対象日（YYYY-MM-DD 形式）
 * @returns 当該月の日数
 */
function daysInMonth(date: string): number {
  const [year, month] = date.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Resend の費用を取得する収集ソースを作る。
 *
 * @param config Resend の設定
 * @param options 依存
 * @returns 収集ソース
 */
export function createResendSource(
  config: ResendConfig,
  options: ResendSourceOptions = {},
): CollectionSource {
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    id: 'resend',
    revisable: false,
    // 送信数の指標を 1 回取得する。
    requestsPerCollection: 1,

    canCollect(date: string, now: string): boolean {
      const limit = new Date(now);
      limit.setUTCDate(limit.getUTCDate() - REACHABLE_DAYS);

      return date >= limit.toISOString().slice(0, 10);
    },

    async collect(date: string): Promise<CollectionResult> {
      const start = `${date}T00:00:00Z`;
      const endDate = new Date(`${date}T00:00:00Z`);
      endDate.setUTCDate(endDate.getUTCDate() + 1);

      const url =
        `${METRICS_ENDPOINT}?dimensions=period` +
        `&start_date=${start}&end_date=${endDate.toISOString()}`;

      const response = await fetchImpl(url, {
        headers: { authorization: `Bearer ${config.apiKey}` },
      });

      if (!response.ok) {
        throw new Error(`Resend の送信数取得に失敗しました: HTTP ${response.status}`);
      }

      const body = (await response.json()) as { data?: MetricsRow[] };
      const row = (body.data ?? []).find((item) => item.period === date);
      const sent = String(row?.sent ?? 0);

      const days = daysInMonth(date);
      const monthlyAmountUsd = config.monthlyAmountUsd;

      const entry: Entry =
        monthlyAmountUsd === undefined
          ? {
              source: 'resend',
              category: 'plan',
              acquisition: 'estimated',
              revisable: false,
              currency: 'JPY',
              amount: roundHalfUp('0', CURRENCY_SCALES.JPY),
              amountJpy: roundHalfUp('0', CURRENCY_SCALES.JPY),
              basis: {
                description: `無料プランのため月額 0 円を日割り。対象日の送信数 ${sent} 通`,
                plan: config.plan,
                quantity: sent,
                daysInMonth: days,
              },
            }
          : {
              source: 'resend',
              category: 'plan',
              acquisition: 'estimated',
              revisable: false,
              currency: 'USD',
              // 浮動小数点を経由せず 10 進固定小数点で日割りする。
              amount: divideDecimals(monthlyAmountUsd, String(days), CURRENCY_SCALES.USD),
              basis: {
                description: `宣言したプランの月額を対象月の日数で日割り。対象日の送信数 ${sent} 通`,
                plan: config.plan,
                unitAmount: monthlyAmountUsd,
                quantity: sent,
                daysInMonth: days,
              },
            };

      return { costs: [entry], revenues: [], raw: body };
    },
  };
}
