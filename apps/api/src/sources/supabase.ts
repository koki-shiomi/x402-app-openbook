import { CURRENCY_SCALES, roundHalfUp, type Entry } from '@openbook/shared';

import type { CollectionResult, CollectionSource } from '../batch.js';
import type { SupabaseConfig } from './config.js';

/**
 * Supabase の費用収集。
 *
 * 課金額と使用量を返す API がないため、組織プランと課金アドオンの有無で
 * 「費用が発生していないこと」を確認する。詳細は
 * specs/cost-collection/spec.md の「Supabase 費用のプラン確認による裏付け」を参照。
 *
 * プランとアドオンは現在の状態しか返さず、過去日の状態を取得する手段がない。
 * 過去日に現在のプランを適用すると、その日の実態と異なる根拠を記録することに
 * なるため、過去日は取得できないものとして扱う。
 */

const API_BASE = 'https://api.supabase.com/v1';

/**
 * 現在の状態を対象日の根拠として使える日数。
 *
 * 日次バッチは前日を対象に実行するため、当日と前日までを取得可能とする。
 */
const REACHABLE_DAYS = 1;

/** プロジェクト 1 件。 */
interface Project {
  ref: string;
  organization_slug: string;
}

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

      const projects = await callApi<Project[]>(fetchImpl, config, 'projects');
      const targets = projects.filter(
        (project) => project.organization_slug === config.orgSlug,
      );

      const addons: Record<string, unknown[]> = {};
      for (const project of targets) {
        const result = await callApi<{ selected_addons?: unknown[] }>(
          fetchImpl,
          config,
          `projects/${project.ref}/billing/addons`,
        );
        addons[project.ref] = result.selected_addons ?? [];
      }

      const applied = Object.values(addons).flat();
      if (applied.length > 0) {
        throw new Error(
          `課金アドオンが ${applied.length} 件適用されているため 0 円として記録できません`,
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
          description: `プラン free、${targets.length} プロジェクトすべてで課金アドオン 0 件を確認`,
          plan: organization.plan,
        },
      };

      return {
        costs: [entry],
        revenues: [],
        raw: { organization, addons },
      };
    },
  };
}
