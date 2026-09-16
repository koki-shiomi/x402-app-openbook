import { describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';

import { createWalletStub, TEST_PRIVATE_KEY } from './support/wallet-stub.js';

/**
 * ウォレットの疑似の実装の確認。
 *
 * 3 章と 4 章のテストは「未接続」「チェーン違い」といった異常系を意図して作る。
 * その土台となる疑似の実装が、指定した状態を返し、本物の署名を作ることを確かめる。
 * 詳細は design.md の決定 8 を参照。
 */

const account = privateKeyToAccount(TEST_PRIVATE_KEY);

describe('ウォレットの疑似の実装', () => {
  it('指定したチェーン ID を返す', async () => {
    const wallet = createWalletStub({ chainId: 5042002 });

    expect(await wallet.request({ method: 'eth_chainId' })).toBe('0x4cef52');
  });

  it('切り替えで保持する値が変わる', async () => {
    const wallet = createWalletStub({ chainId: 1 });

    await wallet.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: '0x4cef52' }],
    });

    expect(await wallet.request({ method: 'eth_chainId' })).toBe('0x4cef52');
  });

  it('署名した値が局所アカウントの署名と一致する', async () => {
    const wallet = createWalletStub({ chainId: 5042002 });

    const typedData = {
      domain: {
        name: 'GatewayWalletBatched',
        version: '1',
        chainId: 5042002,
        verifyingContract: '0x0077777d7eba4688bdef3e311b846f25870a19b9' as const,
      },
      types: {
        TransferWithAuthorization: [
          { name: 'from', type: 'address' },
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'validAfter', type: 'uint256' },
          { name: 'validBefore', type: 'uint256' },
          { name: 'nonce', type: 'bytes32' },
        ],
      },
      primaryType: 'TransferWithAuthorization' as const,
      message: {
        from: account.address,
        to: '0xd77dd307A9E395fB2680011deeD994A27cf70d4b' as const,
        value: 100000n,
        validAfter: 0n,
        validBefore: 1789561517n,
        nonce: `0x${'11'.repeat(32)}` as const,
      },
    };

    const viaStub = await wallet.request({
      method: 'eth_signTypedData_v4',
      params: [account.address, JSON.stringify(typedData, (_k, v) =>
        typeof v === 'bigint' ? v.toString() : v,
      )],
    });

    expect(viaStub).toBe(await account.signTypedData(typedData));
  });

  it('接続していなければアドレスを返さない', async () => {
    const wallet = createWalletStub({ chainId: 5042002, connected: false });

    expect(await wallet.request({ method: 'eth_accounts' })).toEqual([]);
    expect(await wallet.request({ method: 'eth_requestAccounts' })).toEqual([account.address]);
    expect(await wallet.request({ method: 'eth_accounts' })).toEqual([account.address]);
  });

  it('チェーンの追加を拒む設定にできる', async () => {
    const wallet = createWalletStub({ chainId: 1, acceptAddChain: false });

    await expect(
      wallet.request({ method: 'wallet_addEthereumChain', params: [{ chainId: '0x4cef52' }] }),
    ).rejects.toThrow();
  });
});
