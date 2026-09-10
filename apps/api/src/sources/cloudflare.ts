import { CURRENCY_SCALES, roundHalfUp, type Entry } from '@openbook/shared';

import type { CollectionResult, CollectionSource } from '../batch.js';
import type { CloudflareConfig } from './config.js';

/**
 * Cloudflare の費用収集。
 *
 * 課金額を直接返す API がないため、3 つのエンドポイントで「費用が発生していない
 * こと」を確認し、その結果を算出根拠として記録する。詳細は
 * specs/cost-collection/spec.md の「Cloudflare 費用のプラン確認による裏付け」を参照。
 *
 * 請求プロフィールは請求情報の読み取り権限で取得でき、氏名・住所・請求先メール
 * アドレスを返す。権限設定では防げないため、このモジュールからは呼び出さない。
 */

const API_BASE = 'https://api.cloudflare.com/client/v4';

/** 従量課金の 1 リクエストあたりの期間上限（日）。提供元が上限を設けている。 */
const MAX_USAGE_RANGE_DAYS = 31;

/** 対象外とする費用を示す語。ドメイン登録費はアプリの運用費と性質が異なる。 */
const EXCLUDED_DESCRIPTION = /domain/i;

/** 請求実績 1 件。 */
interface BillingHistoryItem {
  type: string;
  occurred_at: string;
  amount: number;
  description?: string;
}

/** Cloudflare 収集ソースの依存。 */
export interface CloudflareSourceOptions {
  fetchImpl?: typeof fetch;
}

/**
 * Cloudflare API を呼び出して `result` を取り出す。
 *
 * @param fetchImpl HTTP 取得に用いる関数
 * @param config Cloudflare の設定
 * @param path アカウント配下のパス
 * @returns 応答の result
 * @throws {Error} 取得に失敗した場合
 */
async function callApi<T>(
  fetchImpl: typeof fetch,
  config: CloudflareConfig,
  path: string,
): Promise<T> {
  const response = await fetchImpl(`${API_BASE}/accounts/${config.accountId}/${path}`, {
    headers: { authorization: `Bearer ${config.token}` },
  });

  if (!response.ok) {
    throw new Error(`Cloudflare の取得に失敗しました (${path}): HTTP ${response.status}`);
  }

  return (await response.json()) as T;
}

/**
 * 対象日を含む取得期間を、上限以内の区間へ分割する。
 *
 * 現在は 1 日分のみを対象とするため区間は 1 つだが、期間を広げても上限を
 * 超えないことを保証する形にしておく。
 *
 * @param from 開始日（YYYY-MM-DD 形式）
 * @param to 終了日（YYYY-MM-DD 形式、含む）
 * @returns 上限以内の区間の配列
 */
export function splitUsageRange(from: string, to: string): { from: string; to: string }[] {
  const ranges: { from: string; to: string }[] = [];
  let cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);

  while (cursor <= end) {
    const chunkEnd = new Date(cursor);
    chunkEnd.setUTCDate(chunkEnd.getUTCDate() + MAX_USAGE_RANGE_DAYS - 1);

    const rangeEnd = chunkEnd > end ? end : chunkEnd;
    ranges.push({
      from: cursor.toISOString().slice(0, 10),
      to: rangeEnd.toISOString().slice(0, 10),
    });

    cursor = new Date(rangeEnd);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return ranges;
}

/**
 * Cloudflare の費用を取得する収集ソースを作る。
 *
 * @param config Cloudflare の設定
 * @param options 依存
 * @returns 収集ソース
 */
export function createCloudflareSource(
  config: CloudflareConfig,
  options: CloudflareSourceOptions = {},
): CollectionSource {
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    id: 'cloudflare',
    revisable: false,

    async collect(date: string): Promise<CollectionResult> {
      const subscriptions = await callApi<{ result: unknown[] }>(
        fetchImpl,
        config,
        'subscriptions',
      );
      if ((subscriptions.result ?? []).length > 0) {
        throw new Error(
          '有料サブスクリプションが存在するため 0 円として記録できません。費用の取得方法を見直してください',
        );
      }

      const usageResults: unknown[] = [];
      for (const range of splitUsageRange(date, date)) {
        const usage = await callApi<{ result: unknown[] }>(
          fetchImpl,
          config,
          `billable-usage?from=${range.from}&to=${range.to}`,
        );
        usageResults.push(...(usage.result ?? []));
      }
      if (usageResults.length > 0) {
        throw new Error(
          '従量課金が発生しているため 0 円として記録できません。費用の取得方法を見直してください',
        );
      }

      const history = await callApi<{ result: BillingHistoryItem[] }>(
        fetchImpl,
        config,
        'billing/history',
      );
      const onTargetDate = (history.result ?? []).filter(
        (item) => item.occurred_at?.slice(0, 10) === date,
      );
      const excluded = onTargetDate.filter((item) =>
        EXCLUDED_DESCRIPTION.test(item.description ?? ''),
      );
      const billable = onTargetDate.filter(
        (item) => !EXCLUDED_DESCRIPTION.test(item.description ?? ''),
      );

      if (billable.length > 0) {
        throw new Error(
          '対象日に請求が発生しているため 0 円として記録できません。費用の取得方法を見直してください',
        );
      }

      const excludedNote =
        excluded.length === 0
          ? ''
          : `。対象外の請求 ${excluded.length} 件（ドメイン登録費）を除外`;

      const entry: Entry = {
        source: 'cloudflare',
        category: 'plan',
        acquisition: 'estimated',
        revisable: false,
        currency: 'JPY',
        amount: roundHalfUp('0', CURRENCY_SCALES.JPY),
        amountJpy: roundHalfUp('0', CURRENCY_SCALES.JPY),
        basis: {
          description:
            `サブスクリプション 0 件、従量課金 0 件、対象日の請求なしを確認${excludedNote}`,
          plan: 'free',
        },
      };

      return {
        costs: [entry],
        revenues: [],
        raw: {
          subscriptions: subscriptions.result,
          billableUsage: usageResults,
          billingHistory: history.result,
        },
      };
    },
  };
}
