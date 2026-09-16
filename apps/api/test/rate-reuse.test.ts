import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DailyRecord, ExchangeRate } from '@openbook/shared';

import { runDaily, type CollectionSource } from '../src/batch.js';
import { recollectRecent } from '../src/schedule.js';
import { getRecord } from '../src/storage.js';

const decoder = new TextDecoder();

const RATE: ExchangeRate = {
  pair: 'USD/JPY',
  rate: '150.00',
  provider: 'frankfurter',
  publishedOn: '2026-09-04',
  fetchedAt: '2026-09-05T06:00:00Z',
};

/** USD 建ての費用を返す収集ソース。 */
function usdSource(amounts: Map<string, string>): CollectionSource {
  return {
    id: 'claude',
    revisable: false,
    requestsPerCollection: 0,
    collect(date: string) {
      return {
        costs: [
          {
            source: 'claude',
            category: 'usage' as const,
            acquisition: 'measured' as const,
            revisable: false,
            currency: 'USD' as const,
            amount: amounts.get(date) ?? '1.000000',
          },
        ],
        revenues: [],
      };
    },
  };
}

/** 対象日のレコードを読む。 */
async function readRecord(date: string): Promise<DailyRecord> {
  return JSON.parse(decoder.decode((await getRecord(env.RECORDS, date))!)) as DailyRecord;
}

beforeEach(async () => {
  const listed = await env.RECORDS.list();
  await Promise.all(listed.objects.map((object) => env.RECORDS.delete(object.key)));
});

describe('再収集での記録済みレートの再利用', () => {
  it('記録済みのレートがある日は提供元へ問い合わせない', async () => {
    const source = usdSource(new Map([['2026-09-05', '1.000000']]));
    await runDaily(env.RECORDS, [source], '2026-09-05', {
      now: '2026-09-06T06:00:00Z',
      fetchRate: async () => RATE,
    });

    const fetchRate = vi.fn(async () => RATE);
    await recollectRecent(env.RECORDS, [source], {
      now: '2026-09-07T06:00:00Z',
      fetchRate,
    });

    expect(fetchRate).not.toHaveBeenCalled();
  });

  it('レートを持たない日は問い合わせる', async () => {
    const source = usdSource(new Map([['2026-09-05', '1.000000']]));
    // 初回はレートを取得できず、`incomplete` に記録される。
    await runDaily(env.RECORDS, [source], '2026-09-05', {
      now: '2026-09-06T06:00:00Z',
      fetchRate: async () => undefined,
    });

    const before = await readRecord('2026-09-05');
    expect(before.exchangeRates).toEqual([]);
    expect(before.incomplete.some((item) => item.kind === 'exchange-rate')).toBe(true);

    const fetchRate = vi.fn(async () => RATE);
    await recollectRecent(env.RECORDS, [source], {
      now: '2026-09-07T06:00:00Z',
      fetchRate,
    });

    expect(fetchRate).toHaveBeenCalledWith('2026-09-05');
  });

  it('再利用したレートの値・提供元・公表日が引き継がれる', async () => {
    const amounts = new Map([['2026-09-05', '1.000000']]);
    const source = usdSource(amounts);
    await runDaily(env.RECORDS, [source], '2026-09-05', {
      now: '2026-09-06T06:00:00Z',
      fetchRate: async () => RATE,
    });

    // 金額を変えて訂正リビジョンを起こし、レートが引き継がれることを見る。
    amounts.set('2026-09-05', '9.000000');
    await recollectRecent(env.RECORDS, [source], {
      now: '2026-09-07T06:00:00Z',
      fetchRate: async () => ({ ...RATE, rate: '999.00', publishedOn: '2026-09-06' }),
    });

    const after = await readRecord('2026-09-05');
    expect(after.revision).toBe(2);
    expect(after.exchangeRates[0]).toMatchObject({
      pair: 'USD/JPY',
      rate: '150.00',
      provider: 'frankfurter',
      publishedOn: '2026-09-04',
    });
  });

  it('レートの違いによる訂正リビジョンが生じない', async () => {
    const source = usdSource(new Map([['2026-09-05', '1.000000']]));
    await runDaily(env.RECORDS, [source], '2026-09-05', {
      now: '2026-09-06T06:00:00Z',
      fetchRate: async () => RATE,
    });

    // 提供元が別の値を返しても、記録済みのレートを使うため内容は変わらない。
    await recollectRecent(env.RECORDS, [source], {
      now: '2026-09-07T06:00:00Z',
      fetchRate: async () => ({ ...RATE, rate: '999.00' }),
    });

    expect(await readRecord('2026-09-05').then((record) => record.revision)).toBe(1);
  });
});
