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
    const wallet = createWalletStub({ chainId: 5042 });

    expect(await wallet.request({ method: 'eth_chainId' })).toBe('0x13b2');
  });

  it('切り替えで保持する値が変わる', async () => {
    const wallet = createWalletStub({ chainId: 1 });

    await wallet.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: '0x13b2' }],
    });

    expect(await wallet.request({ method: 'eth_chainId' })).toBe('0x13b2');
  });

  it('署名した値が局所アカウントの署名と一致する', async () => {
    const wallet = createWalletStub({ chainId: 5042 });

    const typedData = {
      domain: {
        name: 'GatewayWalletBatched',
        version: '1',
        chainId: 5042,
        verifyingContract: '0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE' as const,
      },
      types: {
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'version', type: 'string' },
          { name: 'chainId', type: 'uint256' },
          { name: 'verifyingContract', type: 'address' },
        ],
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

    // 局所アカウントの署名は EIP712Domain を型に含めない。
    const { EIP712Domain: _omit, ...signedTypes } = typedData.types;
    expect(viaStub).toBe(
      await account.signTypedData({ ...typedData, types: signedTypes }),
    );
  });

  it('接続していなければアドレスを返さない', async () => {
    const wallet = createWalletStub({ chainId: 5042, connected: false });

    expect(await wallet.request({ method: 'eth_accounts' })).toEqual([]);
    expect(await wallet.request({ method: 'eth_requestAccounts' })).toEqual([account.address]);
    expect(await wallet.request({ method: 'eth_accounts' })).toEqual([account.address]);
  });

  it('チェーンの追加を拒む設定にできる', async () => {
    const wallet = createWalletStub({ chainId: 1, acceptAddChain: false });

    await expect(
      wallet.request({ method: 'wallet_addEthereumChain', params: [{ chainId: '0x13b2' }] }),
    ).rejects.toThrow();
  });
});

describe('トランザクションの送信', () => {
  it('送ったトランザクションの内容を検査できる', async () => {
    const wallet = createWalletStub({ chainId: 5042 });

    const hash = await wallet.request({
      method: 'eth_sendTransaction',
      params: [{ from: account.address, to: '0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE', data: '0x1234' }],
    });

    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(wallet.sent).toHaveLength(1);
    expect(wallet.sent[0]?.data).toBe('0x1234');
  });
});
