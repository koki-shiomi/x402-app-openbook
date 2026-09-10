import {
  CURRENCY_SCALES,
  multiplyDecimals,
  roundHalfUp,
  type Entry,
} from '@openbook/shared';

import type { CollectionResult, CollectionSource } from '../batch.js';
import type { ClaudeConfig } from './config.js';

/**
 * Claude API の費用収集。
 *
 * Usage & Cost API から対象日の費用を日次バケットで取得する。唯一の変動費であり、
 * 4 提供元のうち実測値を得られる唯一の取得元。詳細は
 * specs/cost-collection/spec.md の「Claude API 費用の実測取得」を参照。
 */

/** Cost API のエンドポイント。 */
const ENDPOINT = 'https://api.anthropic.com/v1/organizations/cost_report';

/** Cost API が返す費用 1 件。 */
interface CostResult {
  /** 通貨コード。応答は USD を返すが、amount の単位はセントである。 */
  currency: string;
  /** 金額。**単位はセント**。 */
  amount: string;
  /** ワークスペース識別子。既定ワークスペースでは null。 */
  workspace_id: string | null;
  /** 費目の説明（モデル名と入出力の別）。 */
  description: string | null;
}

/** Cost API の応答。 */
interface CostReport {
  data: { starting_at: string; results: CostResult[] }[];
}

/**
 * セント単位の金額を USD へ変換する。
 *
 * Cost API の `currency` は `USD` を返すが、`amount` の実際の単位はセントである。
 * 使用量レポートのトークン数と公開単価から計算した値と一致することを実測で確認した
 * （入力 10,071 トークン × $1/MTok = $0.010071 に対し応答は `1.0071`）。
 * そのまま USD として扱うと公開する費用が 100 倍になる。
 *
 * 変換はこの関数 1 箇所に限定する。散らすと 100 倍または 1/100 の誤りが混入する
 * 余地が増える。
 *
 * @param cents セント単位の 10 進小数の文字列
 * @returns USD 単位の 10 進小数の文字列
 */
export function centsToUsd(cents: string): string {
  // 1 セント = 0.01 USD。10 進固定小数点で乗算し、浮動小数点を経由しない。
  const usd = multiplyDecimals(cents, '0.01');

  // 通貨ごとに固定した小数桁数へ揃える。桁が足りなければゼロ詰めされる。
  return roundHalfUp(usd, CURRENCY_SCALES.USD);
}

/** Claude 収集ソースの依存。テストから差し替えられるようにする。 */
export interface ClaudeSourceOptions {
  /** HTTP 取得に用いる関数。 */
  fetchImpl?: typeof fetch;
}

/**
 * 応答の費用が対象ワークスペースに属するかを判定する。
 *
 * @param result 費用 1 件
 * @param config Claude の設定
 * @returns 対象なら true
 */
function isTargetWorkspace(result: CostResult, config: ClaudeConfig): boolean {
  return config.workspace.kind === 'default'
    ? result.workspace_id === null
    : result.workspace_id === config.workspace.workspaceId;
}

/**
 * Claude API の費用を取得する収集ソースを作る。
 *
 * @param config Claude の設定
 * @param options 依存
 * @returns 収集ソース
 */
export function createClaudeSource(
  config: ClaudeConfig,
  options: ClaudeSourceOptions = {},
): CollectionSource {
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    id: 'claude',
    revisable: false,

    async collect(date: string): Promise<CollectionResult> {
      const endingAt = new Date(`${date}T00:00:00Z`);
      endingAt.setUTCDate(endingAt.getUTCDate() + 1);

      const url =
        `${ENDPOINT}?starting_at=${date}T00:00:00Z` +
        `&ending_at=${endingAt.toISOString().slice(0, 10)}T00:00:00Z` +
        `&group_by[]=workspace_id&group_by[]=description`;

      const response = await fetchImpl(url, {
        headers: {
          'anthropic-version': '2023-06-01',
          'x-api-key': config.adminKey,
        },
      });

      if (!response.ok) {
        throw new Error(`Claude の費用取得に失敗しました: HTTP ${response.status}`);
      }

      const report = (await response.json()) as CostReport;
      const costs: Entry[] = [];

      for (const bucket of report.data ?? []) {
        for (const result of bucket.results ?? []) {
          if (!isTargetWorkspace(result, config)) {
            continue;
          }

          costs.push({
            source: 'claude',
            category: result.description ?? 'unknown',
            acquisition: 'measured',
            revisable: false,
            currency: 'USD',
            amount: centsToUsd(result.amount),
          });
        }
      }

      return { costs, revenues: [], raw: report };
    },
  };
}
