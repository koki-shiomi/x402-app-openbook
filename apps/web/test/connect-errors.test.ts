import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mount } from '../src/app.js';
import { ANCHOR_CHAIN_ID } from '../src/config.js';
import { createWalletStub } from './support/wallet-stub.js';

/**
 * 接続の後に起きた失敗の扱いの確認。
 *
 * 接続の直後には、チェーンの確認や残高の照会など、ウォレットや RPC への
 * 問い合わせが続く。これらは接続とは別の理由で失敗しうる。接続できたのに
 * 「接続できなかった」と示すと、利用者は原因を取り違える。しかも接続の操作を
 * 先に取り除いていると、やり直す手段も残らない。
 * 詳細は specs/public-dashboard/spec.md の「接続の後に起きた失敗の扱い」を参照。
 */

/** 一覧を 1 件返す取得関数。 */
const listingFetch = vi.fn(async (input: RequestInfo | URL) => {
  if (String(input).endsWith('/v1/records')) {
    return new Response(JSON.stringify({ records: [{ date: '2026-09-14', revision: 1 }] }), {
      status: 200,
    });
  }
  return new Response('{}', { status: 404 });
}) as unknown as typeof fetch;

/** 残高の照会が失敗する状況を作る。接続そのものは成功する。 */
const failingDeposit = async (): Promise<bigint> => {
  throw new Error('RPC へ接続できませんでした');
};

let container: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '';
  container = document.createElement('div');
  document.body.append(container);
});

describe('接続の後の照会が失敗する', () => {
  it('接続できなかったという理由は示されない', async () => {
    await mount(container, {
      fetchImpl: listingFetch,
      ethereum: createWalletStub({ chainId: ANCHOR_CHAIN_ID }),
      readDeposit: failingDeposit,
    });

    container.querySelector<HTMLElement>('[data-testid="connect"]')?.click();
    await vi.waitFor(() => {
      expect(container.textContent).toMatch(/RPC|失敗|できません/);
    });

    expect(container.textContent).not.toContain('ウォレットへ接続できませんでした');
  });

  it('実際に起きた失敗の内容が示される', async () => {
    await mount(container, {
      fetchImpl: listingFetch,
      ethereum: createWalletStub({ chainId: ANCHOR_CHAIN_ID }),
      readDeposit: failingDeposit,
    });

    container.querySelector<HTMLElement>('[data-testid="connect"]')?.click();
    await vi.waitFor(() => {
      expect(container.textContent).toContain('RPC へ接続できませんでした');
    });
  });
});

describe('失敗した後のやり直し', () => {
  it('接続の操作が残る', async () => {
    await mount(container, {
      fetchImpl: listingFetch,
      ethereum: createWalletStub({ chainId: ANCHOR_CHAIN_ID }),
      readDeposit: failingDeposit,
    });

    container.querySelector<HTMLElement>('[data-testid="connect"]')?.click();
    await vi.waitFor(() => {
      expect(container.textContent).toContain('RPC へ接続できませんでした');
    });

    expect(container.querySelector('[data-testid="connect"]')).not.toBeNull();
  });

  it('やり直して成功すれば残高が表示される', async () => {
    let shouldFail = true;
    await mount(container, {
      fetchImpl: listingFetch,
      ethereum: createWalletStub({ chainId: ANCHOR_CHAIN_ID }),
      readDeposit: async () => {
        if (shouldFail) {
          shouldFail = false;
          throw new Error('RPC へ接続できませんでした');
        }
        return 450000n;
      },
    });

    container.querySelector<HTMLElement>('[data-testid="connect"]')?.click();
    await vi.waitFor(() => {
      expect(container.textContent).toContain('RPC へ接続できませんでした');
    });

    container.querySelector<HTMLElement>('[data-testid="connect"]')?.click();
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="deposit-balance"]')).not.toBeNull();
    });
  });
});
