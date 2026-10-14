import { ARC_NETWORK, roundHalfUp, multiplyDecimals } from '@openbook/shared';
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
 *
 * `ExactEvmScheme` は `@x402/evm` の直下にも同名のクラスがあるが、そちらは署名鍵を
 * 要求する支払う側の実装である。請求する側は `exact/server` の側を用いる。
 */

/** 決済を行うチェーン。刻印と同じチェーンに揃える。 */
export const PAYMENT_NETWORK = ARC_NETWORK.paymentNetwork;

/** 決済に用いる資産（Arc Mainnet の USDC の ERC-20 インタフェース）。 */
export const PAYMENT_ASSET = ARC_NETWORK.paymentAsset;

/** 資産の小数桁数。ERC-20 としての USDC は 6 桁である（ネイティブの 18 桁とは異なる）。 */
const ASSET_DECIMALS = 6;

/** 決済を要求するルートのパターン。 */
export const PAID_ROUTE_PATTERN = 'GET /v1/records/:date';

/**
 * 署名の有効期間に上乗せする余裕（秒）。
 *
 * 利用者は署名の時刻に有効期間を足して期限を決めるが、facilitator は自分が
 * 受け取った時刻を基準に下限を満たすか確かめる。差の分だけ短く見えるため、
 * 下限ちょうどにすると往復の遅れで拒まれうる。
 */
const VALIDITY_MARGIN_SECONDS = 300;

/** facilitator が広告していない場合に用いる、署名の有効期間（秒）。 */
const DEFAULT_TIMEOUT_SECONDS = 300;

/** 支払いの条件のうち、facilitator の広告から決まる部分。 */
interface FacilitatorTerms {
  /** 利用者が署名に用いる EIP-712 のドメインなど。 */
  extra: Record<string, unknown>;
  /** 署名の有効期間（秒）。 */
  maxTimeoutSeconds: number;
}

/**
 * facilitator が広告する条件から、支払いの条件へ載せる値を取り出す。
 *
 * facilitator は自分が広告した `extra` と一致しない条件を `unsupported_scheme`
 * として拒み、広告した有効期間の下限を下回る署名を
 * `authorization_validity_too_short` として拒む。`@x402/hono` は広告を
 * 支払いの条件へ反映しないため、ここで取り出して渡す。
 * 値を固定で書くと、facilitator 側の変更に気づけないまま決済が成立しなくなる。
 *
 * @param client facilitator の実装
 * @returns 支払いの条件へ載せる値
 * @throws 対象のチェーンとスキームを facilitator が扱えない場合
 */
async function resolveFacilitatorTerms(client: FacilitatorClient): Promise<FacilitatorTerms> {
  const supported = await client.getSupported();

  const kind = supported.kinds.find(
    (candidate) => candidate.scheme === 'exact' && candidate.network === PAYMENT_NETWORK,
  );

  if (kind === undefined) {
    throw new Error(`facilitator が ${PAYMENT_NETWORK} の exact に対応していません`);
  }

  const extra = kind.extra ?? {};
  if (typeof extra['verifyingContract'] !== 'string' ||
      extra['verifyingContract'].toLowerCase() !== ARC_NETWORK.gatewayWallet.toLowerCase()) {
    throw new Error('facilitator の Gateway Wallet が公開設定と一致しません');
  }
  const minValidity = extra['minValiditySeconds'];

  return {
    extra,
    maxTimeoutSeconds:
      typeof minValidity === 'number'
        ? minValidity + VALIDITY_MARGIN_SECONDS
        : DEFAULT_TIMEOUT_SECONDS,
  };
}

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
 * 組み立ての前に facilitator の広告を読むため、呼び出しは 1 回の HTTP 通信を伴う。
 * 同じ設定なら isolate 内で使い回す前提である（呼び出し元の `paymentMiddlewareFor`）。
 *
 * @param config 決済の設定
 * @param facilitator facilitator の実装。省略時は設定の URL へ HTTP で接続する
 * @returns Hono のミドルウェア
 * @throws facilitator の広告を読めない、または対象のチェーンに対応していない場合
 */
export async function createPaymentMiddleware(
  config: PaymentConfig,
  facilitator?: FacilitatorClient,
): Promise<MiddlewareHandler> {
  const client = facilitator ?? new HTTPFacilitatorClient({ url: config.facilitatorUrl });
  const { extra, maxTimeoutSeconds } = await resolveFacilitatorTerms(client);

  return paymentMiddlewareFromConfig(
    {
      [PAID_ROUTE_PATTERN]: {
        accepts: {
          scheme: 'exact',
          network: PAYMENT_NETWORK,
          payTo: config.payTo,
          price: { asset: PAYMENT_ASSET, amount: toAssetAmount(config.priceUsdc) },
          maxTimeoutSeconds,
          extra,
        },
        description: '指定した対象日の日次財務レコード（保存されたバイト列そのもの）',
        mimeType: 'application/json',
      },
    },
    client,
    [{ network: PAYMENT_NETWORK, server: new ExactEvmScheme() }],
  );
}
