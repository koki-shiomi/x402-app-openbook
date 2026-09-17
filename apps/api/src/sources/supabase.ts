import { CURRENCY_SCALES, roundHalfUp, type Entry } from '@openbook/shared';

import type { CollectionResult, CollectionSource } from '../batch.js';
import type { SupabaseConfig } from './config.js';

/**
 * Supabase の費用収集。
 *
 * 課金額と使用量を返す API がないため、組織のプランで「費用が発生していないこと」
 * を確認する。課金は組織を単位として行われ、課金アドオンは有料プランのプロジェクト
 * にのみ適用できるため、プランが無料であればアドオンによる費用は生じない。詳細は
 * specs/cost-collection/spec.md の
 * 「Supabase 費用の組織プラン確認による裏付け」を参照。
 *
 * プランは現在の状態しか返さず、過去日の状態を取得する手段がない。過去日に現在の
 * プランを適用すると、その日の実態と異なる根拠を記録することになるため、過去日は
 * 取得できないものとして扱う。
 */

const API_BASE = 'https://api.supabase.com/v1';

/**
 * 現在の状態を対象日の根拠として使える日数。
 *
 * 日次バッチは前日を対象に実行するため、当日と前日までを取得可能とする。
 */
const REACHABLE_DAYS = 1;

/** Supabase 収集ソースの依存。 */
export interface SupabaseSourceOptions {
  fetchImpl?: typeof fetch;
}

/**
 * Supabase Management API を呼び出す。
 *
 * @param fetchImpl HTTP 取得に用いる関数
 * @param config Supabase の設定
 * @param path API のパス
 * @returns 応答本文
 * @throws {Error} 取得に失敗した場合
 */
async function callApi<T>(
  fetchImpl: typeof fetch,
  config: SupabaseConfig,
  path: string,
): Promise<T> {
  const response = await fetchImpl(`${API_BASE}/${path}`, {
    headers: { authorization: `Bearer ${config.pat}` },
  });

  if (!response.ok) {
    throw new Error(`Supabase の取得に失敗しました (${path}): HTTP ${response.status}`);
  }

  return (await response.json()) as T;
}

/**
 * Supabase の費用を取得する収集ソースを作る。
 *
 * @param config Supabase の設定
 * @param options 依存
 * @returns 収集ソース
 */
export function createSupabaseSource(
  config: SupabaseConfig,
  options: SupabaseSourceOptions = {},
): CollectionSource {
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    id: 'supabase',
    revisable: false,
    // 組織のプランを 1 回取得する。プロジェクト数に依存させない。
    requestsPerCollection: 1,

    canCollect(date: string, now: string): boolean {
      const limit = new Date(now);
      limit.setUTCDate(limit.getUTCDate() - REACHABLE_DAYS);

      return date >= limit.toISOString().slice(0, 10);
    },

    async collect(date: string): Promise<CollectionResult> {
      const organization = await callApi<{ plan?: string }>(
        fetchImpl,
        config,
        `organizations/${config.orgSlug}`,
      );

      if (organization.plan !== 'free') {
        throw new Error(
          `プランが free ではないため 0 円として記録できません: ${String(organization.plan)}`,
        );
      }

      const entry: Entry = {
        source: 'supabase',
        category: 'plan',
        acquisition: 'estimated',
        revisable: false,
        currency: 'JPY',
        amount: roundHalfUp('0', CURRENCY_SCALES.JPY),
        amountJpy: roundHalfUp('0', CURRENCY_SCALES.JPY),
        basis: {
          description: `組織のプランが free であることを確認`,
          plan: organization.plan,
        },
      };

      return {
        costs: [entry],
        revenues: [],
        raw: { organization },
      };
    },
  };
}
