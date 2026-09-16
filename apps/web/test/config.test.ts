import { describe, expect, it } from 'vitest';

import { ANCHOR_CHAIN_ID, ANCHOR_CONTRACT, ARC_RPC_URL, GATEWAY_WALLET } from '../src/config.js';
import guide from '../../../docs/verify-anchor.md?raw';

/**
 * 画面の設定値の確認。
 *
 * 照会先が手順書と食い違うと、利用者が手順書どおりに確かめた結果と画面の判定が
 * ずれる。検証の根拠が崩れるため、値が一致していることをテストで固定する。
 * 詳細は design.md の決定 5 を参照。
 */

describe('照会先の設定値', () => {
  it('コントラクトのアドレスが手順書と一致する', () => {
    expect(guide).toContain(ANCHOR_CONTRACT);
  });

  it('チェーン ID が手順書と一致する', () => {
    expect(guide).toContain(String(ANCHOR_CHAIN_ID));
  });

  it('RPC の所在が手順書と一致する', () => {
    expect(guide).toContain(ARC_RPC_URL);
  });

  it('Gateway Wallet のアドレスが決済の取次の広告と一致する', () => {
    // ⑤で facilitator の /supported が広告した verifyingContract。
    expect(GATEWAY_WALLET.toLowerCase()).toBe('0x0077777d7eba4688bdef3e311b846f25870a19b9');
  });
});
