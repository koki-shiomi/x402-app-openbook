/**
 * 画面が持つ設定値。
 *
 * 検証の照会先は API から受け取らず、ここに置いた値を用いる。API が返した情報
 * だけで照合すると、API の自己申告を確かめているにすぎない。照会先まで API から
 * 受け取ると、運営者が用意した別のコントラクトを指すことができてしまう。
 *
 * ここの値は手順書 `docs/verify-anchor.md` に記したものと一致させる。利用者が
 * 手順書どおりに確かめた結果と、画面の判定が同じ根拠に立つようにするためである。
 * 詳細は design.md の決定 5 を参照。
 */

/** 刻印を照会するチェーン。 */
export const ANCHOR_CHAIN_ID = 5042002;

/** 刻印のコントラクトのアドレス。 */
export const ANCHOR_CONTRACT = '0xC039722204Dde6DF3dFb48a9a3068163d30b997a';

/** チェーンの照会先。公開されている RPC であり、秘匿する値ではない。 */
export const ARC_RPC_URL = 'https://rpc.testnet.arc.io';

/**
 * 決済の取次が用いる Gateway Wallet のアドレス。
 *
 * 支払いに使える残高はここへ預け入れた分であり、ウォレットの保有残高ではない。
 * 値は決済の取次が `/supported` で広告する `verifyingContract` と同じものを用いる。
 */
export const GATEWAY_WALLET = '0x0077777d7eba4688bdef3e311b846f25870a19b9';

/** 決済に用いる資産（Arc テストネットの USDC の ERC-20 インタフェース）。 */
export const PAYMENT_ASSET = '0x3600000000000000000000000000000000000000';
