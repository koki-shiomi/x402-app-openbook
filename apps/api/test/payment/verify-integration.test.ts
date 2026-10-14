import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';

import { sha256Hex, verifyAnchoredRecord, ZERO_HASH, type AnchorReader } from '@openbook/shared';
import type { FacilitatorClient } from '@x402/core/server';

import { putAnchorRecord } from '../../src/anchor/store.js';
import { paidRecordMiddleware, serveRecord } from '../../src/api/paid-record.js';
import { recordKey } from '../../src/storage.js';

const PAID_ENV = {
  X402_FACILITATOR_URL: 'https://facilitator.example.com/v1/x402',
  X402_PAY_TO: '0xd77dd307A9E395fB2680011deeD994A27cf70d4b',
  X402_PRICE_USDC: '0.10',
};

const CONTRACT = '0xC039722204Dde6DF3dFb48a9a3068163d30b997a';
const USDC = '0x3600000000000000000000000000000000000000';

beforeEach(async () => {
  const listed = await env.RECORDS.list();
  await Promise.all(listed.objects.map((object) => env.RECORDS.delete(object.key)));
});

/** 成立する facilitator。 */
const facilitator: FacilitatorClient = {
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
            assets: [{ symbol: 'USDC', address: USDC, decimals: 6 }],
          },
        },
      ],
    } as never;
  },
  async verify() {
    return { isValid: true, payer: '0xPayer' } as never;
  },
  async settle() {
    return {
      success: true,
      transaction: '0xsettled',
      network: 'eip155:5042',
      payer: '0xPayer',
    } as never;
  },
};

describe('API で取得したバイト列の検証', () => {
  it('取得したバイト列が検証関数で「現行」と判定される', async () => {
    const date = '2026-09-15';
    const bytes = new TextEncoder().encode(`{"date":"${date}","revision":2}`);
    const hash = await sha256Hex(bytes);

    await env.RECORDS.put(recordKey(date, 2), bytes);
    await putAnchorRecord(env.RECORDS, {
      date,
      revision: 2,
      hash,
      chainId: 5042,
      contractAddress: CONTRACT,
      transactionHash: '0xanchored',
      blockNumber: 100,
      recordedAt: '2026-09-16T00:00:00.000Z',
    });

    const app = new Hono<{ Bindings: Env }>();
    app.use('/v1/records/:date', paidRecordMiddleware({ facilitator }));
    app.get('/v1/records/:date', serveRecord);
    const request = (init?: RequestInit) =>
      app.request(`/v1/records/${date}`, init, { ...env, ...PAID_ENV });

    // 支払いの条件を取得し、それに沿った支払いで本文を得る。
    const unpaid = await request();
    const header = unpaid.headers.get('PAYMENT-REQUIRED');
    const required = JSON.parse(
      header !== null ? atob(header) : await unpaid.text(),
    ) as { accepts: Record<string, unknown>[] };

    const paid = await request({
      headers: {
        'PAYMENT-SIGNATURE': btoa(
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
        ),
      },
    });

    expect(paid.status).toBe(200);
    const body = new Uint8Array(await paid.arrayBuffer());

    // チェーン上の刻印を、応答ヘッダが示す内容で模した照会。
    const reader: AnchorReader = {
      chainId: Number(paid.headers.get('X-Anchor-Chain-Id')),
      contractAddress: paid.headers.get('X-Anchor-Contract')!,
      async hashOf(_date, revision) {
        return revision === 2 ? (hash as `0x${string}`) : ZERO_HASH;
      },
      async latestRevisionOf() {
        return 2;
      },
    };

    const result = await verifyAnchoredRecord(body, reader);

    expect(result).toMatchObject({ kind: 'classified', status: 'current' });
  });
});
