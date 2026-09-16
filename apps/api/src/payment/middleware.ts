import { roundHalfUp, multiplyDecimals } from '@openbook/shared';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { paymentMiddlewareFromConfig } from '@x402/hono';
import { HTTPFacilitatorClient, type FacilitatorClient } from '@x402/core/server';
import type { MiddlewareHandler } from 'hono';

import type { PaymentConfig } from './config.js';

/**
 * x402 による決済のミドルウェア。
 *
 * プロトコルの組み立て（PAYMENT-REQUIRED の提示、PAYMENT-SIGNATURE の解釈、
 * facilitator の呼び出し、PAYMENT-RESPONSE の付与）は @x402/hono に委ねる。
 * 自前で書くとプロトコルの改訂に追従し続ける必要がある。
 * 詳細は specs/x402-payment/spec.md を参照。
 */

/** 決済を行うチェーン。刻印と同じチェーンに揃える。 */
export const PAYMENT_NETWORK = 'eip155:5042002';

/** 決済に用いる資産（Arc Testnet の USDC の ERC-20 インタフェース）。 */
export const PAYMENT_ASSET = '0x3600000000000000000000000000000000000000';

/** 資産の小数桁数。ERC-20 としての USDC は 6 桁である（ネイティブの 18 桁とは異なる）。 */
const ASSET_DECIMALS = 6;

/** 決済を要求するルートのパターン。 */
export const PAID_ROUTE_PATTERN = 'GET /v1/records/:date';

/**
 * USDC の表示単位を、資産の最小単位の整数へ直す。
 *
 * @param priceUsdc 価格（10 進小数の文字列、例 "0.10"）
 * @returns 最小単位の整数の文字列（例 "100000"）
 */
function toAssetAmount(priceUsdc: string): string {
  const scaled = multiplyDecimals(priceUsdc, `1${'0'.repeat(ASSET_DECIMALS)}`);
  return roundHalfUp(scaled, 0);
}

/**
 * 決済のミドルウェアを組み立てる。
 *
 * facilitator との起動時の同期は既定の有効のままとする。isolate ごとに
 * `/supported` を読み直す呼び出しが増えるが、facilitator 側が `extra`
 * （`verifyingContract` など）を変えた場合に自動で追従できる。
 *
 * @param config 決済の設定
 * @param facilitator facilitator の実装。省略時は設定の URL へ HTTP で接続する
 * @returns Hono のミドルウェア
 */
export function createPaymentMiddleware(
  config: PaymentConfig,
  facilitator?: FacilitatorClient,
): MiddlewareHandler {
  const client = facilitator ?? new HTTPFacilitatorClient({ url: config.facilitatorUrl });

  return paymentMiddlewareFromConfig(
    {
      [PAID_ROUTE_PATTERN]: {
        accepts: {
          scheme: 'exact',
          network: PAYMENT_NETWORK,
          payTo: config.payTo,
          price: { asset: PAYMENT_ASSET, amount: toAssetAmount(config.priceUsdc) },
        },
        description: '指定した対象日の日次財務レコード（保存されたバイト列そのもの）',
        mimeType: 'application/json',
      },
    },
    client,
    [{ network: PAYMENT_NETWORK, server: new ExactEvmScheme() }],
  );
}
