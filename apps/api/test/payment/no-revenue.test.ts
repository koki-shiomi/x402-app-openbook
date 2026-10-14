import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import type { DailyRecord } from '@openbook/shared';

import { runDaily, type CollectionSource } from '../../src/batch.js';
import { writePaymentReceipt } from '../../src/payment/receipts.js';
import { getRecord } from '../../src/storage.js';
import { buildCostSources, buildRevenueSources } from '../../src/sources/index.js';

const OPTIONS = { now: '2026-09-16T06:00:00Z', fetchRate: async () => undefined };

beforeEach(async () => {
  const listed = await env.RECORDS.list();
  await Promise.all(listed.objects.map((object) => env.RECORDS.delete(object.key)));
});

describe('x402 の支払いは収益に含めない', () => {
  it('支払いの明細があっても日次レコードの収益に現れない', async () => {
    await writePaymentReceipt(env.RECORDS, {
      settledAt: '2026-09-16T05:30:00.000Z',
      date: '2026-09-15',
      amount: '100000',
      asset: '0x3600000000000000000000000000000000000000',
      network: 'eip155:5042',
      payer: '0x0000000000000000000000000000000000000001',
      transactionHash: '0xsettled',
    });

    // テスト環境では実提供元がすべて失敗しレコードが作られないため、成功する 1 件で代用する。
    const source: CollectionSource = {
      id: 'claude',
      revisable: false,
      requestsPerCollection: 0,
      collect: () => ({
        costs: [
          {
            source: 'claude',
            category: 'plan',
            acquisition: 'measured' as const,
            revisable: false,
            currency: 'JPY' as const,
            amount: '0.00',
            amountJpy: '0.00',
          },
        ],
        revenues: [],
      }),
    };

    await runDaily(env.RECORDS, [source], '2026-09-15', OPTIONS);

    const bytes = await getRecord(env.RECORDS, '2026-09-15');
    const record = JSON.parse(new TextDecoder().decode(bytes!)) as DailyRecord;

    expect(record.revenues.some((entry) => entry.source === 'x402')).toBe(false);
    expect(JSON.stringify(record)).not.toContain('0xsettled');
  });

  it('収集ソースに x402 が登録されていない', () => {
    const sources = [...buildCostSources(env), ...buildRevenueSources(env)];

    expect(sources.map((source) => source.id)).not.toContain('x402');
  });
});
