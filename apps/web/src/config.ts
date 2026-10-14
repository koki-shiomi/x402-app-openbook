import { ARC_CHAIN, ARC_NETWORK } from '@openbook/shared';

/**
 * 画面が持つ設定値。
 *
 * 検証の照会先は API から受け取らず、ここに置いた値を用いる。API が返した情報
 * だけで照合すると、API の自己申告を確かめているにすぎない。照会先まで API から
 * 受け取ると、運営者が用意した別のコントラクトを指すことができてしまう。
 *
 * 照会先は共有パッケージのメインネット設定を用いる。API が広告する照会先で
 * 上書きせず、画面の判定を独立した公開設定に基づかせる。
 * 詳細は design.md の決定 5 を参照。
 */

/** 刻印を照会するチェーン。 */
export const ANCHOR_CHAIN_ID = ARC_CHAIN.id;

/** 刻印のコントラクトのアドレス。 */
export const ANCHOR_CONTRACT = ARC_NETWORK.anchorContract;

/** チェーンの照会先。公開されている RPC であり、秘匿する値ではない。 */
export const ARC_RPC_URL = ARC_CHAIN.rpcUrls.default.http[0];

/**
 * 決済の取次が用いる Gateway Wallet のアドレス。
 *
 * 支払いに使える残高はここへ預け入れた分であり、ウォレットの保有残高ではない。
 * 値は決済の取次が `/supported` で広告する `verifyingContract` と同じものを用いる。
 */
export const GATEWAY_WALLET = ARC_NETWORK.gatewayWallet;

/** 決済に用いる資産（Arc メインネットの USDC の ERC-20 インタフェース）。 */
export const PAYMENT_ASSET = ARC_NETWORK.paymentAsset;
