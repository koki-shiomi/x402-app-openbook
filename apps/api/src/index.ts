import { Hono } from 'hono';

import {
  fetchUsdJpyRate,
  isCalendarDate,
  SCHEMA_VERSION,
  type ExchangeRate,
} from '@openbook/shared';

import { runAnchoring } from './anchor/index.js';
import { listAvailableRecords } from './api/listing.js';
import { paidRecordMiddleware, serveRecord } from './api/paid-record.js';
import { isAuthorized } from './auth.js';
import type { CollectionSource, RunOptions } from './batch.js';
import { isResourceLimitError, RequestBudget } from './budget.js';
import { writeCollectionRun } from './runlog.js';
import {
  buildCostSources,
  buildRevenueSources,
  type BuildSourcesOptions,
} from './sources/index.js';
import { collectWithinReach, runCollection } from './schedule.js';
import { ANCHOR_TRIGGER, findCollectionTrigger, REQUEST_BUDGET } from './triggers.js';

/**
 * 収集ソースを組み立てる。
 *
 * 費用の 4 提供元と収益の 1 提供元を登録する。
 * 認証情報が未設定の提供元も登録され、収集時に理由を伴って失敗し欠測になる。
 *
 * @param env Worker のバインディングとシークレット
 * @returns 収集ソースの配列
 */
function buildSources(env: Env, options: BuildSourcesOptions = {}): CollectionSource[] {
  return [...buildCostSources(env, options), ...buildRevenueSources(env, options)];
}

/**
 * 実行時の依存を組み立てる。
 *
 * 為替レートの取得失敗は例外にせず undefined を返し、呼び出し側で欠測として記録する。
 * ただし実行環境の資源制約による中断は提供元の欠測ではないため、握りつぶさずに
 * 呼び出し側へ伝える。詳細は specs/daily-batch/spec.md の
 * 「実行環境の制約による失敗と提供元の欠測の区別」を参照。
 *
 * レートの取得も 1 回の実行の問い合わせ回数を消費するため、予算つきの取得関数を
 * 受け取れるようにする。予算の外に置くと、上限を消費しながら記録にも見積もりにも
 * 現れない。
 *
 * @param now 実行時刻（RFC 3339）
 * @param options 取得の依存。`fetchImpl` を省くと既定の取得関数を用いる
 * @returns 日次実行の依存
 */
export function buildRunOptions(
  now: string,
  options: { fetchImpl?: typeof fetch } = {},
): RunOptions {
  return {
    now,
    async fetchRate(date: string): Promise<ExchangeRate | undefined> {
      try {
        return await fetchUsdJpyRate(date, {
          now,
          ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
        });
      } catch (error) {
        if (isResourceLimitError(error)) {
          throw error;
        }

        return undefined;
      }
    },
  };
}

const app = new Hono<{ Bindings: Env }>();

/**
 * 稼働確認用のエンドポイント。
 * デプロイ後の疎通確認と、レコード形式のバージョン確認に用いる。
 */
app.get('/health', (c) => c.json({ status: 'ok', schemaVersion: SCHEMA_VERSION }));

/**
 * 取得可能な日付の一覧。支払いは求めない。
 *
 * 対象日とリビジョン番号のみを返し、金額は含めない。刻印済みの日だけが対象になる。
 */
app.get('/v1/records', async (c) => {
  const records = await listAvailableRecords(c.env.RECORDS);
  return c.json({ records });
});

/**
 * 日次レコードの取得。
 *
 * 前段のミドルウェアが対象日の妥当性・レコードの存在・刻印の有無を判定し、
 * 取得できる場合のみ x402 の決済へ進む。決済が成立するとハンドラが本文を返す。
 */
app.use('/v1/records/:date', paidRecordMiddleware());
app.get('/v1/records/:date', serveRecord);

/**
 * 手動再実行。任意の過去日を対象に収集を実行する。
 *
 * 共有シークレットによる Bearer 認証を要求する。利用者は開発者本人 1 名のため、
 * ユーザー管理の仕組みは持たない。
 */
app.post('/admin/rerun', async (c) => {
  if (!isAuthorized(c.req.header('authorization'), c.env.ADMIN_TOKEN)) {
    return c.json({ error: '認証が必要です' }, 401);
  }

  const body = await c.req.json<{ date?: string }>().catch(() => ({ date: undefined }));
  const date = body.date;

  if (typeof date !== 'string' || !isCalendarDate(date)) {
    return c.json({ error: 'date は実在する UTC 暦日である必要があります' }, 400);
  }

  const now = new Date().toISOString();

  // 遡及できない取得元は呼び出さず、既存の値を引き継ぐ。
  const { record, skipped } = await collectWithinReach(
    c.env.RECORDS,
    buildSources(c.env),
    date,
    buildRunOptions(now),
  );

  // 刻印は収集の後段で行う。失敗しても収集の結果には影響しない。
  const anchor = await runAnchoring(c.env.RECORDS, c.env, { now });

  return c.json({ date, revision: record?.revision ?? null, skipped, anchor });
});

export default {
  fetch: app.fetch,

  /**
   * Cron Triggers による定期実行。
   *
   * 1 回の実行で使える外部への問い合わせ回数に上限があるため、収集は複数の定期実行へ
   * 分けて担当させ、刻印はさらに別の定期実行で行う。起動した指定から担当を引く。
   * 詳細は specs/daily-batch/spec.md と design.md の決定 1・2 を参照。
   */
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    const now = new Date(controller.scheduledTime).toISOString();

    if (controller.cron === ANCHOR_TRIGGER) {
      await runAnchoring(env.RECORDS, env, { now });
      return;
    }

    const trigger = findCollectionTrigger(controller.cron);
    if (trigger === undefined) {
      // 設定ファイルと実装の対応が崩れたことを検知できるよう、記録だけ残す。
      await writeCollectionRun(env.RECORDS, {
        startedAt: now,
        finishedAt: now,
        trigger: controller.cron,
        dates: [],
        updated: [],
        requestsUsed: 0,
        requestBudget: REQUEST_BUDGET,
        reason: '担当する定期実行として登録されていません',
      });
      return;
    }

    const budget = new RequestBudget(REQUEST_BUDGET);
    const counted = budget.wrap(fetch);
    const options = { ...buildRunOptions(now, { fetchImpl: counted }), budget };
    const sources = buildSources(env, { fetchImpl: counted });

    await runCollection(env.RECORDS, sources, options, trigger);
  },
} satisfies ExportedHandler<Env>;
