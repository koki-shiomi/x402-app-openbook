import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { runDaily, type CollectionSource } from '../src/batch.js';
import {
  datesInMonth,
  previousDay,
  readClose,
  recollectCurrentMonth,
  runMonthlyClose,
} from '../src/schedule.js';
import { getRecord, isMonthClosed, recordKey } from '../src/storage.js';

const decoder = new TextDecoder();

/** 対象日ごとに与えた金額を返す収集ソース。値を書き換えて改訂を再現する。 */
function mutableSource(amounts: Map<string, string>): CollectionSource {
  return {
    id: 'admob',
    revisable: true,
    collect(date) {
      const amount = amounts.get(date) ?? '0.00';
      return {
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
          },
        ],
      };
    },
  };
}

const OPTIONS = { now: '2026-09-08T06:00:00Z', fetchRate: async () => undefined };

beforeEach(async () => {
  const listed = await env.RECORDS.list();
  await Promise.all(listed.objects.map((object) => env.RECORDS.delete(object.key)));
});

describe('対象日の算出', () => {
  it('実行時刻から見た前日を UTC 暦日で求める', () => {
    expect(previousDay('2026-09-08T06:00:00Z')).toBe('2026-09-07');
  });

  it('月をまたぐ場合も正しく求める', () => {
    expect(previousDay('2026-09-01T06:00:00Z')).toBe('2026-08-31');
  });

  it('うるう日を扱える', () => {
    expect(previousDay('2028-03-01T06:00:00Z')).toBe('2028-02-29');
  });

  it('月内の全日を列挙する', () => {
    expect(datesInMonth('2026-02')).toHaveLength(28);
    expect(datesInMonth('2026-09')[0]).toBe('2026-09-01');
    expect(datesInMonth('2026-09').at(-1)).toBe('2026-09-30');
  });
});

describe('当月中の再収集', () => {
  it('値が変化した日には訂正リビジョンが追加される', async () => {
    const amounts = new Map([['2026-09-05', '10.00']]);
    const source = mutableSource(amounts);
    await runDaily(env.RECORDS, [source], '2026-09-05', OPTIONS);

    amounts.set('2026-09-05', '18.00');
    await recollectCurrentMonth(env.RECORDS, [source], {
      ...OPTIONS,
      now: '2026-09-06T06:00:00Z',
    });

    const record = JSON.parse(decoder.decode((await getRecord(env.RECORDS, '2026-09-05'))!));
    expect(record.revision).toBe(2);
    expect(record.totals.revenueJpy).toBe('18.00');
  });

  it('値が変化しない日にはリビジョンが増えない', async () => {
    const source = mutableSource(new Map([['2026-09-05', '10.00']]));
    await runDaily(env.RECORDS, [source], '2026-09-05', OPTIONS);

    await recollectCurrentMonth(env.RECORDS, [source], {
      ...OPTIONS,
      now: '2026-09-06T06:00:00Z',
    });

    expect(await env.RECORDS.head(recordKey('2026-09-05', 2))).toBeNull();
  });
});

describe('月次クローズ', () => {
  it('前月の全日が再収集され、クローズ済みとして記録される', async () => {
    const amounts = new Map([['2026-08-31', '10.00']]);
    const source = mutableSource(amounts);
    await runDaily(env.RECORDS, [source], '2026-08-31', {
      ...OPTIONS,
      now: '2026-09-01T06:00:00Z',
    });

    amounts.set('2026-08-31', '12.00');
    await runMonthlyClose(env.RECORDS, [source], '2026-08', {
      ...OPTIONS,
      now: '2026-09-06T07:00:00Z',
    });

    expect(await isMonthClosed(env.RECORDS, '2026-08')).toBe(true);

    const close = await readClose(env.RECORDS, '2026-08');
    expect(close?.finalRevisions['2026-08-31']).toBe(2);
  });

  it('遡及できない取得元は再収集されず、その事実が記録に残る', async () => {
    const amounts = new Map([['2026-08-31', '10.00']]);
    const limited: CollectionSource = {
      ...mutableSource(amounts),
      canCollect: () => false,
    };
    await runDaily(env.RECORDS, [limited], '2026-08-31', {
      ...OPTIONS,
      now: '2026-09-01T06:00:00Z',
    });

    amounts.set('2026-08-31', '99.00');
    await runMonthlyClose(env.RECORDS, [limited], '2026-08', {
      ...OPTIONS,
      now: '2026-09-06T07:00:00Z',
    });

    const record = JSON.parse(decoder.decode((await getRecord(env.RECORDS, '2026-08-31'))!));
    expect(record.totals.revenueJpy).toBe('10.00');

    const close = await readClose(env.RECORDS, '2026-08');
    expect(close?.skipped).toEqual([{ source: 'admob', dates: ['2026-08-31'] }]);
  });
});
