import type { FacilitatorClient } from '@x402/core/server';
import type { Context, MiddlewareHandler } from 'hono';

import { readAnchorRecord } from '../anchor/store.js';
import { loadPaymentConfig, type PaymentConfig } from '../payment/config.js';
import { createPaymentMiddleware, PAID_ROUTE_PATTERN } from '../payment/middleware.js';
import { getRecord } from '../storage.js';
import { anchorHeaders } from './record-response.js';
import { resolveRecordAccess, type RecordAccess } from './resolve-record.js';

/**
 * 日次レコードの有料エンドポイントの組み立て。
 *
 * 前段の判定（対象日の妥当性・レコードの存在・刻印の有無）を決済より先に行う。
 * 支払いを求めてから存在しないと返すと、利用者が取得できないものに支払うことになる。
 * @x402/hono のフックでも拒めるが、そちらは 403 固定で 404 と 409 を区別できない。
 * 詳細は specs/paid-record-api/spec.md と specs/x402-payment/spec.md を参照。
 */

/** 前段の判定の結果を後続のハンドラへ渡すためのキー。 */
const ACCESS_KEY = 'recordAccess';

/** 有料エンドポイントのミドルウェアとハンドラが共有する型。 */
type PaidRecordEnv = {
  Bindings: Env;
  Variables: { [ACCESS_KEY]: Extract<RecordAccess, { kind: 'ready' }> };
};

/** 決済のミドルウェアの組み立ての依存。 */
export interface PaidRecordOptions {
  /** facilitator の実装。省略時は設定の URL へ HTTP で接続する。 */
  facilitator?: FacilitatorClient;
}

/**
 * 設定ごとの決済ミドルウェアを isolate 内で使い回す。
 *
 * 組み立てのたびに facilitator との同期が起きるため、同じ設定なら作り直さない。
 */
const middlewareCache = new Map<string, MiddlewareHandler<PaidRecordEnv>>();

/**
 * 決済のミドルウェアを取得する。同じ設定なら isolate 内で使い回す。
 *
 * @param config 決済の設定
 * @param facilitator facilitator の実装
 * @returns 決済のミドルウェア
 */
function paymentMiddlewareFor(
  config: PaymentConfig,
  facilitator?: FacilitatorClient,
): MiddlewareHandler<PaidRecordEnv> {
  // facilitator を差し替える場合は使い回さない（テストごとに挙動が異なるため）。
  if (facilitator !== undefined) {
    return createPaymentMiddleware(config, facilitator) as MiddlewareHandler<PaidRecordEnv>;
  }

  const key = `${config.facilitatorUrl}|${config.payTo}|${config.priceUsdc}`;
  const cached = middlewareCache.get(key);
  if (cached !== undefined) {
    return cached;
  }

  const created = createPaymentMiddleware(config) as MiddlewareHandler<PaidRecordEnv>;
  middlewareCache.set(key, created);
  return created;
}

/**
 * 前段の判定を行い、取得できる場合のみ決済へ進めるミドルウェアを作る。
 *
 * @param options facilitator の差し替え
 * @returns Hono のミドルウェア
 */
export function paidRecordMiddleware(
  options: PaidRecordOptions = {},
): MiddlewareHandler<PaidRecordEnv> {
  return async (c, next) => {
    const access = await resolveRecordAccess(c.env.RECORDS, c.req.param('date') ?? '');

    if (access.kind === 'invalid') {
      return c.json({ error: 'date は実在する UTC 暦日である必要があります' }, 400);
    }
    if (access.kind === 'not-found') {
      return c.json({ error: '指定した対象日のレコードは存在しません' }, 404);
    }
    if (access.kind === 'unanchored') {
      return c.json(
        { date: access.date, reason: 'この日のレコードはまだ刻印されていません（刻印待ち）' },
        409,
      );
    }

    c.set(ACCESS_KEY, access);

    const { config, missing, invalid } = loadPaymentConfig(c.env);
    if (config === undefined) {
      // 決済の設定がないままレコードを無料で配らないよう、利用できないものとして扱う。
      return c.json(
        {
          error: '決済の設定が未完了のため、現在このエンドポイントは利用できません',
          ...(missing.length > 0 ? { missing } : {}),
          ...(invalid === undefined ? {} : { invalid }),
        },
        503,
      );
    }

    return paymentMiddlewareFor(config, options.facilitator)(c, next);
  };
}

/**
 * 刻印済みのレコードを、保存されたバイト列そのままで返す。
 *
 * 前段のミドルウェアが `ready` と判定した場合のみ到達する。
 *
 * @param c Hono のコンテキスト
 * @returns レコードの応答
 */
export async function serveRecord(c: Context<PaidRecordEnv>): Promise<Response> {
  const access = c.get(ACCESS_KEY) as Extract<RecordAccess, { kind: 'ready' }> | undefined;
  if (access === undefined) {
    return c.json({ error: '指定した対象日のレコードは存在しません' }, 404);
  }

  const bytes = await getRecord(c.env.RECORDS, access.date, access.revision);
  const anchor = await readAnchorRecord(c.env.RECORDS, access.date, access.revision);

  if (bytes === null || anchor === null) {
    return c.json({ error: '指定した対象日のレコードは存在しません' }, 404);
  }

  return new Response(bytes, {
    status: 200,
    headers: { 'content-type': 'application/json', ...anchorHeaders(anchor) },
  });
}

export { PAID_ROUTE_PATTERN };
