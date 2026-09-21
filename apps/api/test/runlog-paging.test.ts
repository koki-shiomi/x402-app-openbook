import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { canonicalize } from '@openbook/shared';

import { listPaymentReceipts } from '../src/payment/receipts.js';
import { readCollectionRuns } from '../src/runlog.js';

/**
 * 実行記録の読み出しが、保存されているすべての記録を対象とすることの確認。
 *
 * R2 の 1 度の列挙は既定で 1000 件までしか返さない。続きを辿らないと、記録が
 * 増えたときに一部だけが返る。しかも欠けるのは新しい記録の側になりうるため、
 * 直近の異常ほど見落としやすい。
 * 詳細は specs/daily-batch/spec.md の「実行記録の保存と判断の記録」を参照。
 */

/** R2 の 1 度の列挙が返す既定の上限。これを超える数で確かめる。 */
const LIST_LIMIT = 1000;

const encoder = new TextEncoder();

beforeEach(async () => {
  const listed = await env.RECORDS.list();
  await Promise.all(listed.objects.map((object) => env.RECORDS.delete(object.key)));
});

describe('収集の実行記録の読み出し', () => {
  it('1 度の列挙の上限を超えても、すべての記録が返る', async () => {
    const count = LIST_LIMIT + 5;

    // 連番の時刻で記録を作る。キーの昇順が時系列の順になる。
    await Promise.all(
      Array.from({ length: count }, (_unused, index) => {
        const startedAt = new Date(Date.UTC(2026, 0, 1) + index * 60_000).toISOString();
        const log = {
          startedAt,
          finishedAt: startedAt,
          trigger: '0 6 * * *',
          dates: [],
          updated: [],
          requestsUsed: 0,
          requestBudget: 45,
        };
        const key = `collection-runs/${startedAt.replaceAll(':', '-').replace('.', '-')}_0-6.json`;

        return env.RECORDS.put(key, canonicalize(log));
      }),
    );

    const runs = await readCollectionRuns(env.RECORDS);

    expect(runs).toHaveLength(count);
  });
});

describe('支払いの明細の読み出し', () => {
  it('1 度の列挙の上限を超えても、すべての明細が返る', async () => {
    const date = '2026-09-15';
    const count = LIST_LIMIT + 5;

    await Promise.all(
      Array.from({ length: count }, (_unused, index) => {
        const settledAt = new Date(Date.UTC(2026, 8, 15) + index * 1000).toISOString();
        const receipt = {
          date,
          payer: '0x0000000000000000000000000000000000000001',
          amount: '100000',
          asset: '0x3600000000000000000000000000000000000000',
          network: 'eip155:5042002',
          transactionHash: `id-${index}`,
          settledAt,
        };
        const key = `payments/${date}/${settledAt.replaceAll(':', '-').replace('.', '-')}.json`;

        return env.RECORDS.put(key, encoder.encode(JSON.stringify(receipt)));
      }),
    );

    const receipts = await listPaymentReceipts(env.RECORDS, date);

    expect(receipts).toHaveLength(count);
  });
});
