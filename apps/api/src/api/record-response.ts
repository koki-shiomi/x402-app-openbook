import type { AnchorRecord } from '../anchor/store.js';

/**
 * 日次レコードの応答に添える刻印情報の組み立て。
 *
 * 刻印情報を本文へ混ぜるとバイト列が変わり、SHA-256 が刻印と一致しなくなるため、
 * 応答ヘッダとして別に返す。詳細は specs/paid-record-api/spec.md の「刻印情報の添付」を参照。
 */

/** 刻印情報を格納する応答ヘッダの名前。 */
export const ANCHOR_HEADER_NAMES = [
  'X-Anchor-Revision',
  'X-Anchor-Hash',
  'X-Anchor-Chain-Id',
  'X-Anchor-Contract',
  'X-Anchor-Transaction',
  'X-Anchor-Block',
] as const;

/**
 * 刻印の結果から応答ヘッダを組み立てる。
 *
 * トランザクションのハッシュとブロック番号は、送信前の突き合わせで「既に刻印済み」と
 * 判定したリビジョンでは持たないため、その場合は該当のヘッダを省く。
 *
 * @param anchor 刻印の結果
 * @returns ヘッダ名と値の対応
 */
export function anchorHeaders(anchor: AnchorRecord): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Anchor-Revision': String(anchor.revision),
    'X-Anchor-Hash': anchor.hash,
    'X-Anchor-Chain-Id': String(anchor.chainId),
    'X-Anchor-Contract': anchor.contractAddress,
  };

  if (anchor.transactionHash !== undefined) {
    headers['X-Anchor-Transaction'] = anchor.transactionHash;
  }
  if (anchor.blockNumber !== undefined) {
    headers['X-Anchor-Block'] = String(anchor.blockNumber);
  }

  return headers;
}
