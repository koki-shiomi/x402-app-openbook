import {
  createRegistryReader,
  verifyAnchoredRecord,
  type AnchorReader,
  type VerificationResult,
} from '@openbook/shared';
import type { Address } from 'viem';

import { ANCHOR_CHAIN_ID, ANCHOR_CONTRACT, ARC_RPC_URL } from './config.js';
import type { AnchorHeaders } from './purchase.js';

/**
 * 取得したバイト列の検証。
 *
 * 刻印の照会はブラウザからチェーンへ直接行い、照会先は画面が持つ設定値を用いる。
 * API が返した情報だけで照合すると、API の自己申告を確かめているにすぎない。
 * 照会先まで API から受け取ると、運営者が用意した別のコントラクトを指すことが
 * できてしまう。詳細は design.md の決定 5 を参照。
 */

/**
 * 画面の設定値で刻印を照会する。
 *
 * @returns 刻印の照会
 */
export function createReader(): AnchorReader {
  return createRegistryReader({
    contractAddress: ANCHOR_CONTRACT as Address,
    rpcUrl: ARC_RPC_URL,
  });
}

/**
 * バイト列を検証して分類を返す。
 *
 * 判定に用いるのは、渡されたバイト列とチェーン上の値だけとする。API の応答
 * ヘッダは引数に取らない。
 *
 * @param bytes 取得したバイト列
 * @param reader 刻印の照会。省略時は画面の設定値で組み立てる
 * @returns 検証の結果
 */
export async function verify(
  bytes: Uint8Array,
  reader: AnchorReader = createReader(),
): Promise<VerificationResult> {
  return await verifyAnchoredRecord(bytes, reader);
}

/** 画面の照会先と API が示す値の食い違い 1 件。 */
export interface AnchorDifference {
  field: 'chainId' | 'contract';
  onScreen: string;
  fromApi: string;
}

/** 食い違いの照合の結果。 */
export interface AnchorComparison {
  matches: boolean;
  differences: AnchorDifference[];
}

/**
 * 画面の照会先と、API が応答ヘッダで示す刻印の情報を照合する。
 *
 * 食い違いは表示するにとどめ、検証は画面の設定値で行う。利用者が手順書どおりに
 * 確かめた結果と、画面の判定が同じ根拠に立つようにするためである。
 *
 * @param headers API が示した刻印の情報
 * @returns 照合の結果
 */
export function compareWithHeaders(headers: AnchorHeaders): AnchorComparison {
  const differences: AnchorDifference[] = [];

  if (headers.chainId !== ANCHOR_CHAIN_ID) {
    differences.push({
      field: 'chainId',
      onScreen: String(ANCHOR_CHAIN_ID),
      fromApi: String(headers.chainId),
    });
  }

  if (headers.contract.toLowerCase() !== ANCHOR_CONTRACT.toLowerCase()) {
    differences.push({
      field: 'contract',
      onScreen: ANCHOR_CONTRACT,
      fromApi: headers.contract,
    });
  }

  return { matches: differences.length === 0, differences };
}
