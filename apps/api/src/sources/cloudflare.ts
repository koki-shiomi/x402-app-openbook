import {
  addDecimals,
  CURRENCY_SCALES,
  isDecimalString,
  roundHalfUp,
  type Entry,
} from '@openbook/shared';

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
 *
 * サブスクリプション一覧は現在の契約しか返さず、過去の時点を指定する手段がない。
 * 過去日に現在の契約を適用すると、その日の実態と異なる判定になるため、
 * 過去日は取得できないものとして扱う。
 */

const API_BASE = 'https://api.cloudflare.com/client/v4';

/** 従量課金の 1 リクエストあたりの期間上限（日）。91 日以上を指定すると提供元が要求を拒否する。 */
const MAX_USAGE_RANGE_DAYS = 90;

/**
 * 現在の状態を対象日の根拠として使える日数。
 *
 * 日次バッチは前日を対象に実行するため、当日と前日までを取得可能とする。
 */
const REACHABLE_DAYS = 1;

/** 対象外とする費用を示す語。ドメイン登録費はアプリの運用費と性質が異なる。 */
const EXCLUDED_DESCRIPTION = /domain/i;

/** 請求実績 1 件。 */
interface BillingHistoryItem {
  type: string;
  occurred_at: string;
  amount: number;
  description?: string;
}

/**
 * サブスクリプション 1 件。判定と認証情報の除去に用いる項目を明示する。
 *
 * R2 を有効にすると、価格 0 の契約（R2 Paid）が作成される。
 */
interface Subscription {
  /** 価格。JSON の数値で返る。 */
  price?: unknown;
  /** プラン。表示名を算出根拠に用いる。 */
  rate_plan?: { id?: string; public_name?: string };
  /** 決済用のクライアントシークレット。認証情報を含みうるため保存しない。 */
  client_secrets?: unknown;
  [field: string]: unknown;
}

/**
 * 従量課金 1 行。FOCUS 形式で返る項目のうち、判定と個人情報の除去に用いるものを明示する。
 *
 * 無料枠に含まれる利用も、請求額 0 の行として返る。
 */
interface UsageRow {
  /** 請求額。JSON の数値で返る。 */
  BilledCost?: unknown;
  /** アカウント名。請求先のメールアドレスを含む。 */
  BillingAccountName?: unknown;
  [field: string]: unknown;
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
 * 提供元の期間指定は終端を含まず、終端は開始より後でなければならない。そのため
 * 終了日の翌日を全体の終端とし、各区間の終端も含まない日付で表す。
 * 現在は 1 日分のみを対象とするため区間は 1 つだが、期間を広げても上限を
 * 超えないことを保証する形にしておく。
 *
 * @param from 開始日（YYYY-MM-DD 形式）
 * @param to 終了日（YYYY-MM-DD 形式、含む）
 * @returns 上限以内の区間の配列。各区間の `to` は終端を含まない日付
 */
export function splitUsageRange(from: string, to: string): { from: string; to: string }[] {
  const ranges: { from: string; to: string }[] = [];
  let cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 1);

  while (cursor < end) {
    const chunkEnd = new Date(cursor);
    chunkEnd.setUTCDate(chunkEnd.getUTCDate() + MAX_USAGE_RANGE_DAYS);

    const rangeEnd = chunkEnd > end ? end : chunkEnd;
    ranges.push({
      from: cursor.toISOString().slice(0, 10),
      to: rangeEnd.toISOString().slice(0, 10),
    });

    cursor = rangeEnd;
  }

  return ranges;
}

/**
 * 数値を 10 進小数の文字列へ変換する。
 *
 * JavaScript は極端に小さい・大きい数値を指数表記（例: `1e-7`）で文字列化するため、
 * 指数を展開して 10 進小数の文字列にする。数値の最短表現をそのまま展開し、
 * 桁の追加や丸めは行わない。
 *
 * @param value 変換する有限の数値
 * @returns 10 進小数の文字列
 * @throws {TypeError} 10 進小数として表せない場合
 */
function numberToDecimalString(value: number): string {
  const text = String(value);
  if (isDecimalString(text)) {
    return text;
  }

  const match = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(text);
  if (match === null) {
    throw new TypeError(`10 進小数へ変換できない数値です: ${text}`);
  }

  const sign = match[1] ?? '';
  const digits = (match[2] ?? '') + (match[3] ?? '');
  const pointIndex = 1 + Number(match[4]);

  if (pointIndex <= 0) {
    return `${sign}0.${'0'.repeat(-pointIndex)}${digits}`;
  }
  if (pointIndex >= digits.length) {
    return `${sign}${digits}${'0'.repeat(pointIndex - digits.length)}`;
  }
  return `${sign}${digits.slice(0, pointIndex)}.${digits.slice(pointIndex)}`;
}

/**
 * JSON の数値で返る金額を 10 進小数の文字列へ変換する。
 *
 * 浮動小数点のまま加算・比較すると、相殺して 0 になるはずの合計が 0 に
 * ならない場合があるため、10 進小数の文字列にしてから扱う。
 *
 * @param value 金額として返された値
 * @param unconfirmedMessage 有限の数値でない場合のエラーメッセージ
 * @returns 10 進小数の文字列
 * @throws {Error} 有限の数値でない場合
 */
function toDecimalAmount(value: unknown, unconfirmedMessage: string): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(unconfirmedMessage);
  }
  return numberToDecimalString(value);
}

/**
 * 10 進小数の文字列が 0 を表すかを判定する。
 *
 * @param value 10 進小数の文字列
 * @returns 0 なら true
 */
function isZero(value: string): boolean {
  return /^-?0(\.0+)?$/.test(value);
}

/**
 * サブスクリプションから、認証情報を含みうるクライアントシークレットを取り除く。
 *
 * @param subscription サブスクリプション 1 件
 * @returns クライアントシークレットを除いた複製
 */
function withoutClientSecrets(subscription: Subscription): Subscription {
  const copy = { ...subscription };
  delete copy.client_secrets;
  return copy;
}

/**
 * 従量課金の行から、請求先のメールアドレスを含むアカウント名を取り除く。
 *
 * @param row 従量課金の行
 * @returns アカウント名を除いた行の複製
 */
function withoutAccountName(row: UsageRow): UsageRow {
  const copy = { ...row };
  delete copy.BillingAccountName;
  return copy;
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
    // サブスクリプション・従量課金・請求実績の 3 つを取得する。
    requestsPerCollection: 3,

    canCollect(date: string, now: string): boolean {
      const limit = new Date(now);
      limit.setUTCDate(limit.getUTCDate() - REACHABLE_DAYS);

      return date >= limit.toISOString().slice(0, 10);
    },

    async collect(date: string): Promise<CollectionResult> {
      const subscriptions = await callApi<{ result: Subscription[] | null }>(
        fetchImpl,
        config,
        'subscriptions',
      );
      const subscriptionRows = subscriptions.result ?? [];
      const prices = subscriptionRows.map((subscription) =>
        toDecimalAmount(
          subscription.price,
          '価格を確認できないサブスクリプションがあるため 0 円として記録できません',
        ),
      );
      if (!prices.every(isZero)) {
        throw new Error(
          '価格が 0 でないサブスクリプションが存在するため 0 円として記録できません。費用の取得方法を見直してください',
        );
      }

      const usageRows: UsageRow[] = [];
      for (const range of splitUsageRange(date, date)) {
        const usage = await callApi<{ result: UsageRow[] | null }>(
          fetchImpl,
          config,
          `billable-usage?from=${range.from}&to=${range.to}`,
        );
        usageRows.push(...(usage.result ?? []));
      }

      const billedTotal = addDecimals(
        usageRows.map((row) =>
          toDecimalAmount(
            row.BilledCost,
            '請求額を確認できない従量課金の行があるため 0 円として記録できません',
          ),
        ),
      );
      if (!isZero(billedTotal)) {
        throw new Error(
          `従量課金の請求額が発生しているため 0 円として記録できません（合計 ${billedTotal}）。費用の取得方法を見直してください`,
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

      const planNames = subscriptionRows.map(
        (subscription) =>
          subscription.rate_plan?.public_name ?? subscription.rate_plan?.id ?? '名称不明',
      );
      const subscriptionNote =
        planNames.length === 0
          ? `サブスクリプション 0 件`
          : `サブスクリプション ${planNames.length} 件（${planNames.join('・')}、いずれも価格 0）`;

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
            `${subscriptionNote}、従量課金 ${usageRows.length} 行（請求額の合計 ${billedTotal}）、` +
            `対象日の請求なしを確認${excludedNote}`,
          plan: 'free',
        },
      };

      return {
        costs: [entry],
        revenues: [],
        raw: {
          subscriptions: subscriptionRows.map(withoutClientSecrets),
          billableUsage: usageRows.map(withoutAccountName),
          billingHistory: history.result,
        },
      };
    },
  };
}
