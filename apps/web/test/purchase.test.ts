import { describe, expect, it, vi } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';

import { purchase } from '../src/purchase.js';
import { createWalletStub, TEST_PRIVATE_KEY } from './support/wallet-stub.js';

/**
 * 購入の流れの確認。
 *
 * 支払いなしで要求して条件を受け取り、署名を添えて再要求して本文を得る。
 * 取得したバイト列は保存せず、呼び出し元へ返すだけとする。詳細は
 * specs/public-dashboard/spec.md の「ウォレットによる支払い」を参照。
 */

const account = privateKeyToAccount(TEST_PRIVATE_KEY);

const TERMS = {
  scheme: 'exact',
  network: 'eip155:5042002',
  amount: '100000',
  asset: '0x3600000000000000000000000000000000000000',
  payTo: '0xd77dd307A9E395fB2680011deeD994A27cf70d4b',
  maxTimeoutSeconds: 605100,
  extra: {
    name: 'GatewayWalletBatched',
    version: '1',
    verifyingContract: '0x0077777d7eba4688bdef3e311b846f25870a19b9',
  },
};

const BODY = '{"date":"2026-09-14","revision":1}';

/** 402 を返し、支払いが添えられていれば本文を返す取得関数。 */
function payableFetch() {
  const calls: { url: string; paid: boolean }[] = [];

  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const paid =
      init?.headers !== undefined &&
      new Headers(init.headers).get('PAYMENT-SIGNATURE') !== null;
    calls.push({ url, paid });

    if (!paid) {
      return new Response('{}', {
        status: 402,
        headers: {
          'PAYMENT-REQUIRED': btoa(
            JSON.stringify({ x402Version: 2, accepts: [TERMS], resource: { url } }),
          ),
        },
      });
    }

    return new Response(BODY, {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'X-Anchor-Revision': '1',
        'X-Anchor-Hash': '0x0d12c192da7d580cfb56e9ba3ed0ce413e480b7be83926dbb17b365203986a5e',
        'X-Anchor-Chain-Id': '5042002',
        'X-Anchor-Contract': '0xC039722204Dde6DF3dFb48a9a3068163d30b997a',
      },
    });
  }) as unknown as typeof fetch;

  return { fetchImpl, calls };
}

/** 既定の依存。 */
function deps(overrides: Record<string, unknown> = {}) {
  return {
    ethereum: createWalletStub({ chainId: 5042002 }),
    readDeposit: async () => 500000n,
    ...overrides,
  };
}

describe('購入の流れ', () => {
  it('支払いのない要求で 402 を受け取り、署名を添えた要求で本文を受け取る', async () => {
    const { fetchImpl, calls } = payableFetch();

    const result = await purchase('2026-09-14', { fetchImpl, ...deps() });

    expect(calls.map((call) => call.paid)).toEqual([false, true]);
    expect(result.ok).toBe(true);
    expect(result.ok === true && new TextDecoder().decode(result.bytes)).toBe(BODY);
  });

  it('刻印の情報が応答ヘッダから取り出される', async () => {
    const { fetchImpl } = payableFetch();

    const result = await purchase('2026-09-14', { fetchImpl, ...deps() });

    expect(result.ok === true && result.anchorHeaders).toEqual({
      revision: 1,
      hash: '0x0d12c192da7d580cfb56e9ba3ed0ce413e480b7be83926dbb17b365203986a5e',
      chainId: 5042002,
      contract: '0xC039722204Dde6DF3dFb48a9a3068163d30b997a',
    });
  });

  it('事前条件を満たさなければ署名を求めず理由を返す', async () => {
    const { fetchImpl, calls } = payableFetch();
    const wallet = createWalletStub({ chainId: 5042002 });
    const seen: string[] = [];
    const watching = {
      ...wallet,
      async request(request: { method: string; params?: unknown[] }) {
        seen.push(request.method);
        return wallet.request(request);
      },
    };

    const result = await purchase('2026-09-14', {
      fetchImpl,
      ...deps({ ethereum: watching, readDeposit: async () => 0n }),
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('insufficient-deposit');
    expect(seen).not.toContain('eth_signTypedData_v4');
    // 支払いを添えた要求は送らない。
    expect(calls.every((call) => !call.paid)).toBe(true);
  });

  it('秘密鍵の入力を求めない', async () => {
    const { fetchImpl } = payableFetch();
    const wallet = createWalletStub({ chainId: 5042002 });
    const seen: string[] = [];
    const watching = {
      ...wallet,
      async request(request: { method: string; params?: unknown[] }) {
        seen.push(request.method);
        return wallet.request(request);
      },
    };

    await purchase('2026-09-14', { fetchImpl, ...deps({ ethereum: watching }) });

    // 署名はウォレットの中で行われ、鍵を渡す口は存在しない。
    expect(seen).toEqual(['eth_accounts', 'eth_chainId', 'eth_signTypedData_v4']);
  });

  it('取得した内容をブラウザの保存領域へ書かない', async () => {
    const { fetchImpl } = payableFetch();
    localStorage.clear();
    sessionStorage.clear();

    await purchase('2026-09-14', { fetchImpl, ...deps() });

    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('402 以外が返れば理由を添えて返す', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ date: '2026-09-15', reason: '刻印待ち' }), { status: 409 }),
    ) as unknown as typeof fetch;

    const result = await purchase('2026-09-15', { fetchImpl, ...deps() });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('not-purchasable');
    expect(result.ok === false && result.message).toContain('刻印');
  });
});

describe('署名の内容', () => {
  it('接続したアドレスが支払い元になる', async () => {
    const { fetchImpl } = payableFetch();
    let signedFrom: string | undefined;
    const wallet = createWalletStub({ chainId: 5042002 });
    const watching = {
      ...wallet,
      async request(request: { method: string; params?: unknown[] }) {
        if (request.method === 'eth_signTypedData_v4') {
          signedFrom = request.params?.[0] as string;
        }
        return wallet.request(request);
      },
    };

    await purchase('2026-09-14', { fetchImpl, ...deps({ ethereum: watching }) });

    expect(signedFrom).toBe(account.address);
  });
});
