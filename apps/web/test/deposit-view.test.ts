import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mount } from '../src/app.js';
import { ANCHOR_CHAIN_ID } from '../src/config.js';
import { createWalletStub } from './support/wallet-stub.js';

/**
 * 決済に使える残高の表示と、画面からの預け入れの確認。
 *
 * ウォレットに資産を保有していても、取次へ預け入れていなければ決済は成立しない。
 * この区別は分かりにくく、残高があるのに支払えない状態に見える。使える額を明示し、
 * その場で預け入れられるようにする。詳細は specs/public-dashboard/spec.md の
 * 「決済に使える残高の確認と預け入れ」を参照。
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

let container: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '';
  container = document.createElement('div');
  document.body.append(container);
});

describe('決済に使える残高の表示', () => {
  it('接続すると預け入れ残高が表示される', async () => {
    await mount(container, {
      fetchImpl: listingFetch,
      ethereum: createWalletStub({ chainId: ANCHOR_CHAIN_ID }),
      readDeposit: async () => 450000n,
    });

    container.querySelector<HTMLElement>('[data-testid="connect"]')?.click();
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="deposit-balance"]')).not.toBeNull();
    });

    // 0.45 USDC。最小単位ではなく表示単位で示す。
    expect(container.querySelector('[data-testid="deposit-balance"]')?.textContent).toContain(
      '0.45',
    );
  });

  it('ウォレットの保有残高を決済に使える額として示さない', async () => {
    await mount(container, {
      fetchImpl: listingFetch,
      ethereum: createWalletStub({ chainId: ANCHOR_CHAIN_ID }),
      readDeposit: async () => 0n,
    });

    container.querySelector<HTMLElement>('[data-testid="connect"]')?.click();
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="deposit-balance"]')).not.toBeNull();
    });

    const panel = container.querySelector('[data-testid="deposit-panel"]');
    // 預け入れた額だけを「決済に使える」として示す。
    expect(panel?.textContent).toContain('決済に使える');
    expect(panel?.textContent).toContain('0.00');
  });

  it('額を指定して預け入れられる', async () => {
    const wallet = createWalletStub({ chainId: ANCHOR_CHAIN_ID });
    let balance = 0n;

    await mount(container, {
      fetchImpl: listingFetch,
      ethereum: wallet,
      readDeposit: async () => balance,
      depositWaitMs: 0,
    });

    container.querySelector<HTMLElement>('[data-testid="connect"]')?.click();
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="deposit-amount"]')).not.toBeNull();
    });

    const input = container.querySelector<HTMLInputElement>('[data-testid="deposit-amount"]')!;
    input.value = '1.5';

    // 送信したら反映されたことにする。
    setTimeout(() => {
      balance = 1_500_000n;
    }, 0);

    container.querySelector<HTMLElement>('[data-testid="deposit-submit"]')?.click();

    await vi.waitFor(() => {
      expect(wallet.sent).toHaveLength(1);
    }, { timeout: 5000 });

    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="deposit-balance"]')?.textContent).toContain('1.50');
    }, { timeout: 5000 });
  }, 20000);
});
