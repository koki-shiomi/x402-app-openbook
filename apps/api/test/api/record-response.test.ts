import { describe, expect, it } from 'vitest';

import { anchorHeaders } from '../../src/api/record-response.js';
import type { AnchorRecord } from '../../src/anchor/store.js';

const BASE: AnchorRecord = {
  date: '2026-09-15',
  revision: 2,
  hash: '0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  chainId: 5042002,
  contractAddress: '0xC039722204Dde6DF3dFb48a9a3068163d30b997a',
  transactionHash: '0x93dcca0e02cb1b2da2ef1610af6cfc0451cd99fa2d02e336eeaeb833a4c91703',
  blockNumber: 62351751,
  recordedAt: '2026-09-16T05:23:29.245Z',
};

describe('刻印情報の応答ヘッダ', () => {
  it('リビジョン・ハッシュ・チェーン ID・コントラクト・トランザクション・ブロック番号が返る', () => {
    const headers = anchorHeaders(BASE);

    expect(headers).toEqual({
      'X-Anchor-Revision': '2',
      'X-Anchor-Hash': BASE.hash,
      'X-Anchor-Chain-Id': '5042002',
      'X-Anchor-Contract': BASE.contractAddress,
      'X-Anchor-Transaction': BASE.transactionHash,
      'X-Anchor-Block': '62351751',
    });
  });

  it('トランザクションのハッシュを持たない刻印では該当のヘッダを省き他は返る', () => {
    const { transactionHash: _tx, blockNumber: _block, ...withoutTx } = BASE;

    const headers = anchorHeaders(withoutTx);

    expect(headers).toEqual({
      'X-Anchor-Revision': '2',
      'X-Anchor-Hash': BASE.hash,
      'X-Anchor-Chain-Id': '5042002',
      'X-Anchor-Contract': BASE.contractAddress,
    });
  });
});
