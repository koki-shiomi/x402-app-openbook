import { describe, expect, it } from 'vitest';

import { ANCHOR_CHAIN_ID, ANCHOR_CONTRACT, ARC_RPC_URL, GATEWAY_WALLET } from '../src/config.js';
import { ARC_CHAIN, ARC_NETWORK } from '@openbook/shared';

/**
 * 画面の設定値の確認。
 *
 * 照会先は API の応答ではなく共有の公開設定に基づく。
 * 文書を読み込まず、画面が共有設定を使うことを確認する。
 * 詳細は design.md の決定 5 を参照。
 */

describe('照会先の設定値', () => {
  it('コントラクトのアドレスが共有設定と一致する', () => {
    expect(ANCHOR_CONTRACT).toBe(ARC_NETWORK.anchorContract);
  });

  it('チェーン ID が共有設定と一致する', () => {
    expect(ANCHOR_CHAIN_ID).toBe(ARC_CHAIN.id);
  });

  it('RPC の所在が共有設定と一致する', () => {
    expect(ARC_RPC_URL).toBe(ARC_CHAIN.rpcUrls.default.http[0]);
  });

  it('Gateway Wallet のアドレスが決済の取次の広告と一致する', () => {
    // ⑤で facilitator の /supported が広告した verifyingContract。
    expect(GATEWAY_WALLET.toLowerCase()).toBe('0x77777777dcc4d5a8b6e418fd04d8997ef11000ee');
  });
});
