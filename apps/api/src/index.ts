import { Hono } from 'hono';

import {
  fetchUsdJpyRate,
  isCalendarDate,
  SCHEMA_VERSION,
  type ExchangeRate,
} from '@openbook/shared';

import { isAuthorized } from './auth.js';
import { runDaily, type CollectionSource, type RunOptions } from './batch.js';
import {
  previousDay,
  previousMonth,
  recollectCurrentMonth,
  runMonthlyClose,
} from './schedule.js';
import { isMonthClosed } from './storage.js';

/**
 * 収集ソースの登録先。
 *
 * 実際の取得元は後続チェンジ（②費用収集・③収益収集）で追加する。
 * 0 件でも日次実行が成立することを基盤の要件としている。
 */
const SOURCES: CollectionSource[] = [];

/**
 * 実行時の依存を組み立てる。
 *
 * 為替レートの取得失敗は例外にせず undefined を返し、呼び出し側で欠測として記録する。
 *
 * @param now 実行時刻（RFC 3339）
 * @returns 日次実行の依存
 */
function buildRunOptions(now: string): RunOptions {
  return {
    now,
    async fetchRate(date: string): Promise<ExchangeRate | undefined> {
      try {
        return await fetchUsdJpyRate(date, { now });
      } catch {
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
 * 手動再実行。クローズされていない月の任意の日を対象に収集を実行する。
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

  if (await isMonthClosed(c.env.RECORDS, date.slice(0, 7))) {
    return c.json({ error: 'クローズ済みの月は再実行できません' }, 409);
  }

  const record = await runDaily(
    c.env.RECORDS,
    SOURCES,
    date,
    buildRunOptions(new Date().toISOString()),
  );

  return c.json({ date, revision: record?.revision ?? null });
});

export default {
  fetch: app.fetch,

  /**
   * Cron Triggers による定期実行。
   *
   * 日次実行では前日を対象に収集し、あわせて当月内の各日を再収集する。
   * 月次クローズでは前月の最終リビジョンを確定させ、その月への書き込みを締め切る。
   */
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    const now = new Date(controller.scheduledTime).toISOString();
    const options = buildRunOptions(now);

    if (controller.cron === '0 7 6 * *') {
      await runMonthlyClose(env.RECORDS, SOURCES, previousMonth(now), options);
      return;
    }

    await runDaily(env.RECORDS, SOURCES, previousDay(now), options);
    await recollectCurrentMonth(env.RECORDS, SOURCES, options);
  },
} satisfies ExportedHandler<Env>;
