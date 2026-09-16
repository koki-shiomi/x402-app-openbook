import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';

import { sha256Hex } from '@openbook/shared';
import type { FacilitatorClient } from '@x402/core/server';

import { putAnchorRecord } from '../../src/anchor/store.js';
import { listPaymentReceipts } from '../../src/payment/receipts.js';
import { paidRecordMiddleware, serveRecord } from '../../src/api/paid-record.js';
import { recordKey } from '../../src/storage.js';

const PAID_ENV = {
  X402_FACILITATOR_URL: 'https://facilitator.example.com/v1/x402',
  X402_PAY_TO: '0xd77dd307A9E395fB2680011deeD994A27cf70d4b',
  X402_PRICE_USDC: '0.10',
};

const USDC = '0x3600000000000000000000000000000000000000';

const SUPPORTED = {
  kinds: [
    {
      x402Version: 2,
      scheme: 'exact',
      network: 'eip155:5042002',
      extra: {
        name: 'GatewayWalletBatched',
        version: '1',
        verifyingContract: '0x0077777d7eba4688bdef3e311b846f25870a19b9',
        assets: [{ symbol: 'USDC', address: USDC, decimals: 6 }],
      },
    },
  ],
};

beforeEach(async () => {
  const listed = await env.RECORDS.list();
  await Promise.all(listed.objects.map((object) => env.RECORDS.delete(object.key)));
});

/** 刻印済みのレコードを 1 件用意する。 */
async function seedAnchoredRecord(date: string, revision = 1): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(`{"date":"${date}","revision":${revision}}`);
  await env.RECORDS.put(recordKey(date, revision), bytes);
  await putAnchorRecord(env.RECORDS, {
    date,
    revision,
    hash: await sha256Hex(bytes),
    chainId: 5042002,
    contractAddress: '0xC039722204Dde6DF3dFb48a9a3068163d30b997a',
    transactionHash: '0xabc',
    blockNumber: 100,
    recordedAt: '2026-09-16T00:00:00.000Z',
  });
  return bytes;
}

/** facilitator の応答を差し替える。 */
function fakeFacilitator(behavior: 'valid' | 'invalid' | 'unreachable'): FacilitatorClient {
  const unreachable = () => {
    throw new Error('facilitator へ到達できません');
  };

  return {
    async getSupported() {
      return SUPPORTED as never;
    },
    async verify() {
      if (behavior === 'unreachable') unreachable();
      return (behavior === 'valid'
        ? { isValid: true, payer: '0xPayer' }
        : { isValid: false, invalidReason: 'insufficient_funds' }) as never;
    },
    async settle() {
      if (behavior === 'unreachable') unreachable();
      return (behavior === 'valid'
        ? { success: true, transaction: '0xsettled', network: 'eip155:5042002', payer: '0xPayer' }
        : { success: false, errorReason: 'settlement_failed' }) as never;
    },
  };
}

/** テスト用のアプリを組み立てる。 */
function buildApp(behavior: 'valid' | 'invalid' | 'unreachable', paymentEnv = PAID_ENV) {
  const app = new Hono<{ Bindings: Env }>();
  app.use('/v1/records/:date', paidRecordMiddleware({ facilitator: fakeFacilitator(behavior) }));
  app.get('/v1/records/:date', serveRecord);
  return {
    request: (path: string, init?: RequestInit) =>
      app.request(path, init, { ...env, ...paymentEnv }),
  };
}

describe('決済を伴うレコードの取得', () => {
  it('支払いのない要求では本文を返さず 402 を返す', async () => {
    await seedAnchoredRecord('2026-09-15');

    const response = await buildApp('valid').request('/v1/records/2026-09-15');

    expect(response.status).toBe(402);
    expect(await response.text()).not.toContain('"revision"');
  });

  it('成立が確認できなければ本文を返さず 402 を返す', async () => {
    await seedAnchoredRecord('2026-09-15');

    const response = await buildApp('invalid').request('/v1/records/2026-09-15', {
      headers: { 'PAYMENT-SIGNATURE': btoa(JSON.stringify({ x402Version: 2 })) },
    });

    expect(response.status).toBe(402);
  });

  it('facilitator へ到達できなければ本文を返さない', async () => {
    await seedAnchoredRecord('2026-09-15');

    const response = await buildApp('unreachable').request('/v1/records/2026-09-15', {
      headers: { 'PAYMENT-SIGNATURE': btoa(JSON.stringify({ x402Version: 2 })) },
    });

    expect(response.status).not.toBe(200);
  });
});

describe('決済が成立した場合', () => {
  /** 402 の応答から支払いの条件を取り出し、それに沿った支払いのヘッダを組み立てる。 */
  async function paymentHeaderFor(app: ReturnType<typeof buildApp>, path: string) {
    const unpaid = await app.request(path);
    const header = unpaid.headers.get('PAYMENT-REQUIRED');
    const required = JSON.parse(
      header !== null ? atob(header) : await unpaid.text(),
    ) as { accepts: Record<string, unknown>[] };

    const payload = {
      x402Version: 2,
      accepted: required.accepts[0],
      payload: {
        signature: `0x${'11'.repeat(65)}`,
        authorization: {
          from: '0x0000000000000000000000000000000000000001',
          to: PAID_ENV.X402_PAY_TO,
          value: '100000',
          validAfter: '0',
          validBefore: String(Math.floor(Date.now() / 1000) + 3600),
          nonce: `0x${'22'.repeat(32)}`,
        },
      },
    };

    return btoa(JSON.stringify(payload));
  }

  it('成立が確認できれば本文と成立の結果が返る', async () => {
    const bytes = await seedAnchoredRecord('2026-09-15');
    const app = buildApp('valid');

    const response = await app.request('/v1/records/2026-09-15', {
      headers: { 'PAYMENT-SIGNATURE': await paymentHeaderFor(app, '/v1/records/2026-09-15') },
    });

    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.clone().arrayBuffer())).toEqual(bytes);
    expect(response.headers.get('PAYMENT-RESPONSE')).not.toBeNull();
  });

  it('返した本文の SHA-256 が刻印と一致し、刻印情報がヘッダで返る', async () => {
    await seedAnchoredRecord('2026-09-15');
    const app = buildApp('valid');

    const response = await app.request('/v1/records/2026-09-15', {
      headers: { 'PAYMENT-SIGNATURE': await paymentHeaderFor(app, '/v1/records/2026-09-15') },
    });

    const body = new Uint8Array(await response.arrayBuffer());
    expect(response.headers.get('X-Anchor-Hash')).toBe(await sha256Hex(body));
    expect(response.headers.get('X-Anchor-Revision')).toBe('1');
    expect(response.headers.get('X-Anchor-Transaction')).toBe('0xabc');
  });
});

describe('支払いの明細', () => {
  /** 402 の応答から支払いの条件を取り出し、それに沿った支払いのヘッダを組み立てる。 */
  async function paymentHeaderFor(app: ReturnType<typeof buildApp>, path: string) {
    const unpaid = await app.request(path);
    const header = unpaid.headers.get('PAYMENT-REQUIRED');
    const required = JSON.parse(
      header !== null ? atob(header) : await unpaid.text(),
    ) as { accepts: Record<string, unknown>[] };

    return btoa(
      JSON.stringify({
        x402Version: 2,
        accepted: required.accepts[0],
        payload: {
          signature: `0x${'11'.repeat(65)}`,
          authorization: {
            from: '0x0000000000000000000000000000000000000001',
            to: PAID_ENV.X402_PAY_TO,
            value: '100000',
            validAfter: '0',
            validBefore: String(Math.floor(Date.now() / 1000) + 3600),
            nonce: `0x${'22'.repeat(32)}`,
          },
        },
      }),
    );
  }

  it('決済が成立すると明細が保存される', async () => {
    await seedAnchoredRecord('2026-09-15');
    const app = buildApp('valid');

    await app.request('/v1/records/2026-09-15', {
      headers: { 'PAYMENT-SIGNATURE': await paymentHeaderFor(app, '/v1/records/2026-09-15') },
    });

    const receipts = await listPaymentReceipts(env.RECORDS, '2026-09-15');

    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
      date: '2026-09-15',
      amount: '100000',
      asset: USDC,
      network: 'eip155:5042002',
      transactionHash: '0xsettled',
    });
    expect(receipts[0]?.settledAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('成立しなかった支払いでは明細が保存されない', async () => {
    await seedAnchoredRecord('2026-09-15');
    const app = buildApp('invalid');

    await app.request('/v1/records/2026-09-15', {
      headers: { 'PAYMENT-SIGNATURE': await paymentHeaderFor(app, '/v1/records/2026-09-15') },
    });

    expect(await listPaymentReceipts(env.RECORDS, '2026-09-15')).toEqual([]);
  });

  it('支払いのない要求では明細が保存されない', async () => {
    await seedAnchoredRecord('2026-09-15');

    await buildApp('valid').request('/v1/records/2026-09-15');

    expect(await listPaymentReceipts(env.RECORDS, '2026-09-15')).toEqual([]);
  });
});

describe('明細の保存に失敗した場合', () => {
  it('本文は返る', async () => {
    const bytes = await seedAnchoredRecord('2026-09-15');
    const app = buildApp('valid');

    const unpaid = await app.request('/v1/records/2026-09-15');
    const header = unpaid.headers.get('PAYMENT-REQUIRED');
    const required = JSON.parse(
      header !== null ? atob(header) : await unpaid.text(),
    ) as { accepts: Record<string, unknown>[] };
    const signature = btoa(
      JSON.stringify({
        x402Version: 2,
        accepted: required.accepts[0],
        payload: {
          signature: `0x${'11'.repeat(65)}`,
          authorization: {
            from: '0x0000000000000000000000000000000000000001',
            to: PAID_ENV.X402_PAY_TO,
            value: '100000',
            validAfter: '0',
            validBefore: String(Math.floor(Date.now() / 1000) + 3600),
            nonce: `0x${'22'.repeat(32)}`,
          },
        },
      }),
    );

    // 明細の保存だけを失敗させる。
    const original = env.RECORDS.put;
    env.RECORDS.put = (async (key: string, ...rest: unknown[]) => {
      if (key.startsWith('payments/')) {
        throw new Error('保存に失敗しました');
      }
      return (original as (...args: unknown[]) => unknown).call(env.RECORDS, key, ...rest);
    }) as typeof env.RECORDS.put;

    try {
      const response = await app.request('/v1/records/2026-09-15', {
        headers: { 'PAYMENT-SIGNATURE': signature },
      });

      expect(response.status).toBe(200);
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    } finally {
      env.RECORDS.put = original;
    }

    expect(await listPaymentReceipts(env.RECORDS, '2026-09-15')).toEqual([]);
  });
});

describe('決済の設定が未設定のとき', () => {
  it('有料のエンドポイントは 503 を返す', async () => {
    await seedAnchoredRecord('2026-09-15');

    const response = await buildApp('valid', {} as typeof PAID_ENV).request(
      '/v1/records/2026-09-15',
    );

    expect(response.status).toBe(503);
  });

  it('設定が未設定でも前段の判定は先に働く', async () => {
    const response = await buildApp('valid', {} as typeof PAID_ENV).request(
      '/v1/records/2026-09-15',
    );

    // レコードがないため、決済の設定を見る前に 404 が返る。
    expect(response.status).toBe(404);
  });
});
