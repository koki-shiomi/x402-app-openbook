import { beforeEach, describe, expect, it, vi } from 'vitest';

import { sha256Hex } from '@openbook/shared';

import { mount } from '../src/app.js';
import { ANCHOR_CHAIN_ID, ANCHOR_CONTRACT } from '../src/config.js';
import { createWalletStub } from './support/wallet-stub.js';

/**
 * 一覧から購入・明細・検証までの通しの確認。
 *
 * 画面が API の内容を確かめるためのものである以上、一連の流れが実際に成立する
 * ことを 1 本で確かめる。
 */

const RECORD = {
  schemaVersion: 1,
  date: '2026-09-14',
  revision: 1,
  generatedAt: '2026-09-15T06:00:02.000Z',
  costs: [
    {
      source: 'claude',
      category: 'usage',
      acquisition: 'measured',
      revisable: false,
      currency: 'JPY',
      amount: '151.07',
      amountJpy: '151.07',
    },
  ],
  revenues: [],
  incomplete: [],
  exchangeRates: [],
  totals: { revenueJpy: '0.00', costJpy: '151.07', profitJpy: '-151.07', incomplete: false },
};

const BODY = JSON.stringify(RECORD);

const TERMS = {
  scheme: 'exact',
  network: `eip155:${ANCHOR_CHAIN_ID}`,
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

let container: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '';
  container = document.createElement('div');
  document.body.append(container);
});

describe('一覧から検証までの通し', () => {
  it('購入すると明細と検証の結果が表示される', async () => {
    const hash = await sha256Hex(new TextEncoder().encode(BODY));

    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith('/v1/records')) {
        return new Response(JSON.stringify({ records: [{ date: '2026-09-14', revision: 1 }] }), {
          status: 200,
        });
      }

      const paid = new Headers(init?.headers).get('PAYMENT-SIGNATURE') !== null;
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
          'X-Anchor-Revision': '1',
          'X-Anchor-Hash': hash,
          'X-Anchor-Chain-Id': String(ANCHOR_CHAIN_ID),
          'X-Anchor-Contract': ANCHOR_CONTRACT,
        },
      });
    }) as unknown as typeof fetch;

    await mount(container, {
      fetchImpl,
      ethereum: createWalletStub({ chainId: ANCHOR_CHAIN_ID }),
      readDeposit: async () => 500000n,
      reader: {
        chainId: ANCHOR_CHAIN_ID,
        contractAddress: ANCHOR_CONTRACT,
        async hashOf() {
          return hash;
        },
        async latestRevisionOf() {
          return 1;
        },
      },
    });

    container.querySelector<HTMLElement>('[data-testid="buy"]')?.click();
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="verification"]')).not.toBeNull();
    });

    // 明細が描かれている。
    expect(container.querySelector('[data-testid="entry"][data-source="claude"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="totals"]')?.textContent).toContain('151.07');

    // チェーンを照会した結果として「現行」と判定される。
    expect(container.querySelector('[data-testid="status"]')?.textContent).toContain('現行');
    expect(container.querySelector('[data-testid="evidence"]')?.textContent).toContain(hash);

    // 照会先が食い違っていないため、その節は出ない。
    expect(container.querySelector('[data-testid="source-mismatch"]')).toBeNull();
  }, 20000);
});
