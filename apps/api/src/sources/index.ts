import type { CollectionResult, CollectionSource } from '../batch.js';
import { createAdmobSource } from './admob.js';
import { createClaudeSource } from './claude.js';
import { createCloudflareSource } from './cloudflare.js';
import {
  loadAdmobConfig,
  loadCostConfig,
  type AdmobConfigInput,
  type CostConfigInput,
} from './config.js';
import { createResendSource } from './resend.js';
import { createSupabaseSource } from './supabase.js';

/**
 * 費用の収集ソースの組み立て。
 *
 * 認証情報が未設定の提供元も収集ソースとして登録し、収集時に理由を伴って失敗させる。
 * 登録から外すと、公開データ上で「無料枠内で 0 円」と「そもそも取得していない」が
 * 区別できなくなる。失敗は日次バッチの部分失敗として扱われ、欠測に記録される。
 */

/** 収集ソースの組み立てに渡す依存。 */
export interface BuildSourcesOptions {
  /** HTTP 取得に用いる関数。テストから差し替える。 */
  fetchImpl?: typeof fetch;
}

/**
 * 設定が欠けている提供元を表す収集ソースを作る。
 *
 * @param id 取得元の識別子
 * @param reason 設定が欠けている理由
 * @returns 収集時に必ず失敗する収集ソース
 */
function createUnconfiguredSource(id: string, reason: string): CollectionSource {
  return {
    id,
    revisable: false,
    // 設定がないため外部へは問い合わせず、必ず失敗する。
    requestsPerCollection: 0,
    collect(): CollectionResult {
      throw new Error(reason);
    },
  };
}

/**
 * 環境から費用の収集ソースを組み立てる。
 *
 * @param input 環境から読み取った設定値
 * @param options 依存
 * @returns 4 提供元の収集ソース
 */
export function buildCostSources(
  input: CostConfigInput,
  options: BuildSourcesOptions = {},
): CollectionSource[] {
  const config = loadCostConfig(input);
  const missingById = new Map(config.missing.map((item) => [item.source, item.reason]));

  const build = (
    id: string,
    create: (() => CollectionSource) | undefined,
  ): CollectionSource => {
    const reason = missingById.get(id);
    return reason === undefined && create !== undefined
      ? create()
      : createUnconfiguredSource(id, reason ?? `${id} の設定が読み取れませんでした`);
  };

  return [
    build(
      'claude',
      config.claude === undefined
        ? undefined
        : () => createClaudeSource(config.claude!, options),
    ),
    build(
      'cloudflare',
      config.cloudflare === undefined
        ? undefined
        : () => createCloudflareSource(config.cloudflare!, options),
    ),
    build(
      'resend',
      config.resend === undefined
        ? undefined
        : () => createResendSource(config.resend!, options),
    ),
    build(
      'supabase',
      config.supabase === undefined
        ? undefined
        : () => createSupabaseSource(config.supabase!, options),
    ),
  ];
}

/**
 * 環境から収益の収集ソースを組み立てる。
 *
 * 費用とは別の関数にするのは、費用の組み立て関数の責務を変えずに追加するため。
 *
 * @param input 環境から読み取った設定値
 * @param options 依存
 * @returns AdMob の収集ソース
 */
export function buildRevenueSources(
  input: AdmobConfigInput,
  options: BuildSourcesOptions = {},
): CollectionSource[] {
  const config = loadAdmobConfig(input);

  return [
    config.admob === undefined
      ? createUnconfiguredSource(
          'admob',
          config.missing[0]?.reason ?? 'AdMob の設定が読み取れませんでした',
        )
      : createAdmobSource(config.admob, options),
  ];
}
