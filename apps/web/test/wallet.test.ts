import { describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';

import { connect, ensureChain, findProvider } from '../src/wallet.js';
import { createWalletStub, TEST_PRIVATE_KEY } from './support/wallet-stub.js';

/**
 * ウォレットの接続と切り替えの確認。
 *
 * 秘密鍵は画面へ入力させず、署名はウォレットの中で行う。詳細は
 * specs/public-dashboard/spec.md の「ウォレットによる支払い」を参照。
 */

const account = privateKeyToAccount(TEST_PRIVATE_KEY);

describe('ウォレットの接続', () => {
  it('接続するとアドレスが得られる', async () => {
    const wallet = createWalletStub({ chainId: 5042002, connected: false });

    expect(await connect(wallet)).toBe(account.address);
  });

  it('ウォレットが無ければその旨を返す', () => {
    expect(findProvider({})).toBeUndefined();
  });

  it('ウォレットがあれば取り出せる', () => {
    const wallet = createWalletStub({ chainId: 5042002 });

    expect(findProvider({ ethereum: wallet })).toBe(wallet);
  });
});

describe('チェーンの切り替え', () => {
  it('切り替えを要求すると接続先が変わる', async () => {
    const wallet = createWalletStub({ chainId: 1 });

    await ensureChain(wallet, 5042002);

    expect(wallet.chainId).toBe(5042002);
  });

  it('既に一致していれば要求しない', async () => {
    const wallet = createWalletStub({ chainId: 5042002 });
    const seen: string[] = [];
    const watching = {
      ...wallet,
      async request(request: { method: string; params?: unknown[] }) {
        seen.push(request.method);
        return wallet.request(request);
      },
    };

    await ensureChain(watching, 5042002);

    expect(seen).not.toContain('wallet_switchEthereumChain');
  });

  it('ウォレットが当該チェーンを知らなければ追加を要求する', async () => {
    const wallet = createWalletStub({ chainId: 1 });
    const seen: string[] = [];
    const unknownChain = {
      ...wallet,
      async request(request: { method: string; params?: unknown[] }) {
        seen.push(request.method);
        if (request.method === 'wallet_switchEthereumChain') {
          // 未登録のチェーンに対する既定の応答に合わせる。
          throw Object.assign(new Error('Unrecognized chain ID'), { code: 4902 });
        }
        return wallet.request(request);
      },
    };

    await ensureChain(unknownChain, 5042002);

    expect(seen).toContain('wallet_addEthereumChain');
  });

  it('追加を拒まれたら失敗として返す', async () => {
    const wallet = createWalletStub({ chainId: 1, acceptAddChain: false });
    const unknownChain = {
      ...wallet,
      async request(request: { method: string; params?: unknown[] }) {
        if (request.method === 'wallet_switchEthereumChain') {
          throw Object.assign(new Error('Unrecognized chain ID'), { code: 4902 });
        }
        return wallet.request(request);
      },
    };

    await expect(ensureChain(unknownChain, 5042002)).rejects.toThrow();
  });
});
