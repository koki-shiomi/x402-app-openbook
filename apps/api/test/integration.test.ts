import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  canonicalize,
  validateRecord,
  addDecimals,
  type DailyRecord,
  type ExchangeRate,
} from '@openbook/shared';

import { runDaily, type CollectionSource } from '../src/batch.js';
import { runMonthlyClose } from '../src/schedule.js';
import { getRecord, listRecords, putRecord } from '../src/storage.js';

const decoder = new TextDecoder();

const RATE: ExchangeRate = {
  pair: 'USD/JPY',
  rate: '147.25',
  provider: 'frankfurter',
  publishedOn: '2026-09-07',
  fetchedAt: '2026-09-08T06:00:00Z',
};

const OPTIONS = { now: '2026-09-08T06:00:00Z', fetchRate: async () => undefined };
const WITH_RATE = { now: '2026-09-08T06:00:00Z', fetchRate: async () => RATE };

/** USD 建ての実測費用を返す取得元。 */
const usdCost: CollectionSource = {
  id: 'claude',
  revisable: false,
  collect: () => ({
    costs: [
      {
        source: 'claude',
        category: 'input-tokens',
        acquisition: 'measured' as const,
        revisable: false,
        currency: 'USD' as const,
        amount: '0.010071',
      },
    ],
    revenues: [],
  }),
};

/** 無料プランのため 0 円である取得元。 */
const freeTier: CollectionSource = {
  id: 'supabase',
  revisable: false,
  collect: () => ({
    costs: [
      {
        source: 'supabase',
        category: 'plan',
        acquisition: 'estimated' as const,
        revisable: false,
        currency: 'JPY' as const,
        amount: '0.00',
        amountJpy: '0.00',
        basis: { description: '無料プランのため月額 0 円を日割り', plan: 'free' },
      },
    ],
    revenues: [],
  }),
};

/** 後から値が改訂される収益の取得元。 */
function admob(amount: string): CollectionSource {
  return {
    id: 'admob',
    revisable: true,
    collect: () => ({
      costs: [],
      revenues: [
        {
          source: 'admob',
          category: 'estimated-earnings',
          acquisition: 'measured' as const,
          revisable: true,
          currency: 'JPY' as const,
          amount,
          amountJpy: amount,
          sourceTimezone: 'America/Los_Angeles',
        },
      ],
    }),
  };
}

beforeEach(async () => {
  const listed = await env.RECORDS.list();
  await Promise.all(listed.objects.map((object) => env.RECORDS.delete(object.key)));
});

describe('収集ソース 0 件の通し実行', () => {
  it('生成されたレコードが正準表現の検証とバリデーションを両方通過する', async () => {
    await runDaily(env.RECORDS, [], '2026-09-07', OPTIONS);

    const bytes = (await getRecord(env.RECORDS, '2026-09-07'))!;
    const record = JSON.parse(decoder.decode(bytes)) as DailyRecord;

    expect(validateRecord(record)).toEqual([]);
    // 保存物と、読み戻して再直列化した結果が一致する。
    expect(canonicalize(record)).toEqual(bytes);
  });
});

describe('複数取得元の通し実行', () => {
  it('換算・集計・保存・期間取得が一貫して動作する', async () => {
    await runDaily(env.RECORDS, [usdCost, freeTier, admob('30.00')], '2026-09-07', WITH_RATE);

    const record = JSON.parse(
      decoder.decode((await getRecord(env.RECORDS, '2026-09-07'))!),
    ) as DailyRecord;

    // USD 建ては換算され、原通貨・原金額・適用レートが残る。
    const claude = record.costs.find((entry) => entry.source === 'claude');
    expect(claude).toMatchObject({
      currency: 'USD',
      amount: '0.010071',
      exchangeRate: '147.25',
      amountJpy: '1.48',
    });

    // 無料プランの 0 円は estimated として残り、欠測にはならない。
    expect(record.costs.find((entry) => entry.source === 'supabase')).toMatchObject({
      acquisition: 'estimated',
      amountJpy: '0.00',
    });
    expect(record.incomplete).toEqual([]);

    expect(record.totals).toEqual({
      costJpy: '1.48',
      revenueJpy: '30.00',
      profitJpy: '28.52',
      incomplete: false,
    });
    expect(validateRecord(record)).toEqual([]);

    const listed = await listRecords(env.RECORDS, '2026-09-01', '2026-09-30');
    expect(listed.map((entry) => entry.date)).toEqual(['2026-09-07']);
  });
});

describe('日次実行から月次クローズまで', () => {
  it('当月中は値の変化でリビジョンが増え、クローズ後は書き込みが拒否される', async () => {
    await runDaily(env.RECORDS, [admob('10.00')], '2026-08-31', {
      ...OPTIONS,
      now: '2026-09-01T06:00:00Z',
    });
    await runDaily(env.RECORDS, [admob('14.00')], '2026-08-31', {
      ...OPTIONS,
      now: '2026-09-02T06:00:00Z',
    });

    const beforeClose = JSON.parse(
      decoder.decode((await getRecord(env.RECORDS, '2026-08-31'))!),
    ) as DailyRecord;
    expect(beforeClose.revision).toBe(2);

    await runMonthlyClose(env.RECORDS, [admob('14.00')], '2026-08', {
      ...OPTIONS,
      now: '2026-09-06T07:00:00Z',
    });

    await expect(
      putRecord(env.RECORDS, { ...beforeClose, revision: 9 }),
    ).rejects.toThrow(/クローズ済み/);
  });
});

describe('月次収支の算出', () => {
  it('日次レコードの集計として算出でき、月次レコードは保存されていない', async () => {
    await runDaily(env.RECORDS, [admob('10.00')], '2026-09-05', OPTIONS);
    await runDaily(env.RECORDS, [admob('20.00')], '2026-09-06', OPTIONS);

    const listed = await listRecords(env.RECORDS, '2026-09-01', '2026-09-30');
    const records = listed.map(
      (entry) => JSON.parse(decoder.decode(entry.bytes)) as DailyRecord,
    );

    expect(addDecimals(records.map((record) => record.totals.revenueJpy))).toBe('30.00');

    // 月次を表すレコードは保存していない。
    const keys = (await env.RECORDS.list()).objects.map((object) => object.key);
    expect(keys.filter((key) => /^months\//.test(key))).toEqual([]);
    expect(keys.filter((key) => /^records\/\d{4}-\d{2}\.json$/.test(key))).toEqual([]);
  });
});
