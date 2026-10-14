import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { listPaymentReceipts, paymentReceiptKey, writePaymentReceipt } from '../../src/payment/receipts.js';

const RECEIPT = {
  settledAt: '2026-09-16T05:30:00.000Z',
  date: '2026-09-15',
  amount: '100000',
  asset: '0x3600000000000000000000000000000000000000',
  network: 'eip155:5042',
  payer: '0x0000000000000000000000000000000000000001',
  transactionHash: '0xsettled',
};

beforeEach(async () => {
  const listed = await env.RECORDS.list();
  await Promise.all(listed.objects.map((object) => env.RECORDS.delete(object.key)));
});

describe('支払いの明細', () => {
  it('対象日と成立時刻からキーが決まる', () => {
    expect(paymentReceiptKey('2026-09-15', '2026-09-16T05:30:00.000Z')).toBe(
      'payments/2026-09-15/2026-09-16T05-30-00-000Z.json',
    );
  });

  it('成立時刻・対象日・金額・資産・ネットワーク・支払い元・トランザクションが保存される', async () => {
    await writePaymentReceipt(env.RECORDS, RECEIPT);

    const stored = await listPaymentReceipts(env.RECORDS, '2026-09-15');

    expect(stored).toEqual([RECEIPT]);
  });

  it('同じ対象日への 2 回の支払いが別々に残る', async () => {
    await writePaymentReceipt(env.RECORDS, RECEIPT);
    await writePaymentReceipt(env.RECORDS, {
      ...RECEIPT,
      settledAt: '2026-09-16T06:00:00.000Z',
      payer: '0x0000000000000000000000000000000000000002',
    });

    const stored = await listPaymentReceipts(env.RECORDS, '2026-09-15');

    expect(stored).toHaveLength(2);
    expect(stored.map((receipt) => receipt.payer)).toEqual([
      '0x0000000000000000000000000000000000000001',
      '0x0000000000000000000000000000000000000002',
    ]);
  });

  it('対象日ごとに引ける', async () => {
    await writePaymentReceipt(env.RECORDS, RECEIPT);
    await writePaymentReceipt(env.RECORDS, { ...RECEIPT, date: '2026-09-14' });

    expect(await listPaymentReceipts(env.RECORDS, '2026-09-14')).toHaveLength(1);
    expect(await listPaymentReceipts(env.RECORDS, '2026-09-15')).toHaveLength(1);
  });
});
