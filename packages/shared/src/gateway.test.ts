import { describe, expect, it } from 'vitest';

import { GATEWAY_WALLET_ABI } from './gateway.js';

/**
 * Gateway Wallet の ABI の確認。
 *
 * 支払いに使える残高はウォレットの保有残高ではなく、ここへ預け入れた分である。
 * 判定に用いる関数の形が実際のコントラクトと食い違うと、照会が失敗する。
 */

describe('Gateway Wallet の ABI', () => {
  it('availableBalance が token と account を取り uint256 を返す', () => {
    const fn = GATEWAY_WALLET_ABI.find((item) => item.name === 'availableBalance');

    expect(fn?.inputs.map((input) => input.type)).toEqual(['address', 'address']);
    expect(fn?.outputs.map((output) => output.type)).toEqual(['uint256']);
    expect(fn?.stateMutability).toBe('view');
  });

  it('残高の照会に用いる関数だけを持つ', () => {
    // withdrawableBalance は引き出しの待機期間を表し、支払いの可否とは別の概念。
    // 取り違えると、預け入れ済みでも支払えないと誤って判定する。
    const names: readonly string[] = GATEWAY_WALLET_ABI.map((item) => item.name);

    expect(names).toEqual(['availableBalance']);
  });
});
