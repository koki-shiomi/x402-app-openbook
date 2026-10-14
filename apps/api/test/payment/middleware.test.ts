import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import type { FacilitatorClient } from '@x402/core/server';

import { createPaymentMiddleware } from '../../src/payment/middleware.js';
import type { PaymentConfig } from '../../src/payment/config.js';

const CONFIG: PaymentConfig = {
  facilitatorUrl: 'https://facilitator.example.com/v1/x402',
  payTo: '0xd77dd307A9E395fB2680011deeD994A27cf70d4b',
  priceUsdc: '0.10',
};

const USDC = '0x3600000000000000000000000000000000000000';

/** facilitator の応答を差し替える。実ネットワークへは接続しない。 */
function fakeFacilitator(): FacilitatorClient {
  return {
    async getSupported() {
      return {
        kinds: [
          {
            x402Version: 2,
            scheme: 'exact',
            network: 'eip155:5042',
            extra: {
              name: 'GatewayWalletBatched',
              version: '1',
              verifyingContract: '0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE',
              minValiditySeconds: 604800,
              assets: [{ symbol: 'USDC', address: USDC, decimals: 6 }],
            },
          },
        ],
      } as unknown as Awaited<ReturnType<FacilitatorClient['getSupported']>>;
    },
    async verify() {
      return { isValid: false, invalidReason: 'テストでは検証しない' } as unknown as Awaited<
        ReturnType<FacilitatorClient['verify']>
      >;
    },
    async settle() {
      return { success: false } as unknown as Awaited<ReturnType<FacilitatorClient['settle']>>;
    },
  };
}

/** ミドルウェアを適用した最小のアプリを作る。 */
async function appWithPayment() {
  const app = new Hono();
  app.use('/v1/records/:date', await createPaymentMiddleware(CONFIG, fakeFacilitator()));
  app.get('/v1/records/:date', (c) => c.text('本文'));
  return app;
}

/** 402 応答から支払いの条件を取り出す。 */
async function paymentRequirements(response: Response) {
  const header = response.headers.get('PAYMENT-REQUIRED');
  if (header !== null) {
    return JSON.parse(atob(header)) as { accepts: Record<string, unknown>[] };
  }
  return (await response.json()) as { accepts: Record<string, unknown>[] };
}

describe('x402 のミドルウェア', () => {
  it('広告の Gateway Wallet が公開設定と異なれば決済を開始しない', async () => {
    const facilitator = fakeFacilitator();
    const getSupported = facilitator.getSupported.bind(facilitator);
    facilitator.getSupported = async () => {
      const supported = await getSupported();
      supported.kinds[0]!.extra = { ...supported.kinds[0]!.extra, verifyingContract: '0x0000000000000000000000000000000000000001' };
      return supported;
    };
    await expect(createPaymentMiddleware(CONFIG, facilitator)).rejects.toThrow(/Gateway Wallet/);
  });

  it('支払いのない要求に 402 と支払いの条件が返る', async () => {
    const response = await (await appWithPayment()).request('/v1/records/2026-09-15');

    expect(response.status).toBe(402);
    const body = await paymentRequirements(response);
    expect(body.accepts.length).toBeGreaterThan(0);
  });

  it('条件のネットワーク・資産・金額・受取先が設定どおりである', async () => {
    const response = await (await appWithPayment()).request('/v1/records/2026-09-15');

    const [accepted] = (await paymentRequirements(response)).accepts;

    expect(accepted).toMatchObject({
      scheme: 'exact',
      network: 'eip155:5042',
      asset: USDC,
      amount: '100000',
      payTo: CONFIG.payTo,
    });
  });

  it('条件の extra が facilitator の広告と一致する', async () => {
    const response = await (await appWithPayment()).request('/v1/records/2026-09-15');

    const [accepted] = (await paymentRequirements(response)).accepts;

    // 広告と異なる extra を提示すると facilitator が unsupported_scheme で拒む。
    expect(accepted?.extra).toEqual({
      name: 'GatewayWalletBatched',
      version: '1',
      verifyingContract: '0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE',
      minValiditySeconds: 604800,
      assets: [{ symbol: 'USDC', address: USDC, decimals: 6 }],
    });
  });

  it('署名の有効期間が facilitator の下限を下回らない', async () => {
    const response = await (await appWithPayment()).request('/v1/records/2026-09-15');

    const [accepted] = (await paymentRequirements(response)).accepts;

    // 下回ると facilitator が authorization_validity_too_short で拒む。
    expect(accepted?.maxTimeoutSeconds).toBeGreaterThanOrEqual(604800);
  });

  it('対象日が違っても同じ価格が提示される', async () => {
    const app = await appWithPayment();

    const first = (await paymentRequirements(await app.request('/v1/records/2026-09-14'))).accepts[0];
    const second = (await paymentRequirements(await app.request('/v1/records/2026-09-15'))).accepts[0];

    expect(first?.amount).toBe(second?.amount);
    expect(first?.amount).toBe('100000');
  });
});
