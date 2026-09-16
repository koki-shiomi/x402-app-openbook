import { describe, expect, it, vi } from 'vitest';

import { RECOLLECTION_DAYS } from '@openbook/shared';

import { estimateRequests, recollectionDates } from '../src/schedule.js';
import {
  ANCHOR_TRIGGER,
  COLLECTION_TRIGGERS,
  REQUEST_BUDGET,
  findCollectionTrigger,
} from '../src/triggers.js';
import { buildCostSources, buildRevenueSources } from '../src/sources/index.js';

/** 担当範囲が覆うオフセットを列挙する。 */
function offsetsOf(range: { from: number; to: number }): number[] {
  const offsets: number[] = [];
  for (let offset = range.from; offset <= range.to; offset += 1) {
    offsets.push(offset);
  }
  return offsets;
}

const ALL_OFFSETS = COLLECTION_TRIGGERS.flatMap((trigger) => offsetsOf(trigger.slice));

describe('定期実行の担当範囲', () => {
  it('担当範囲が互いに重ならない', () => {
    expect(new Set(ALL_OFFSETS).size).toBe(ALL_OFFSETS.length);
  });

  it('合わせると 2 日前から対象期間の末日までを覆う', () => {
    const expected: number[] = [];
    for (let offset = 2; offset <= RECOLLECTION_DAYS; offset += 1) {
      expected.push(offset);
    }

    expect([...ALL_OFFSETS].sort((a, b) => a - b)).toEqual(expected);
  });

  it('前日はいずれの再収集の担当範囲にも含まれない', () => {
    expect(ALL_OFFSETS).not.toContain(1);
  });

  it('前日の収集を担当するのは最初の定期実行だけである', () => {
    const collectors = COLLECTION_TRIGGERS.filter((trigger) => trigger.collectPreviousDay);

    expect(collectors).toHaveLength(1);
    expect(collectors[0]).toBe(COLLECTION_TRIGGERS[0]);
  });

  it('刻印の定期実行は収集の定期実行より後の時刻である', () => {
    const minuteOf = (cron: string): number => {
      const [minute, hour] = cron.split(' ');
      return Number(hour) * 60 + Number(minute);
    };

    const latestCollection = Math.max(
      ...COLLECTION_TRIGGERS.map((trigger) => minuteOf(trigger.cron)),
    );
    expect(minuteOf(ANCHOR_TRIGGER)).toBeGreaterThan(latestCollection);
  });

  it('定期実行の間隔が 20 分以上ある', () => {
    const minutes = [...COLLECTION_TRIGGERS.map((t) => t.cron), ANCHOR_TRIGGER]
      .map((cron) => {
        const [minute, hour] = cron.split(' ');
        return Number(hour) * 60 + Number(minute);
      })
      .sort((a, b) => a - b);

    for (let i = 1; i < minutes.length; i += 1) {
      expect(minutes[i]! - minutes[i - 1]!).toBeGreaterThanOrEqual(20);
    }
  });

  it('既知の指定から担当が引ける', () => {
    expect(findCollectionTrigger(COLLECTION_TRIGGERS[0]!.cron)).toBe(COLLECTION_TRIGGERS[0]);
    expect(findCollectionTrigger('99 9 * * *')).toBeUndefined();
  });
});

describe('担当範囲ごとの問い合わせ回数の見積もり', () => {
  const FULL_ENV = {
    CLAUDE_ADMIN_KEY: 'sk-ant-admin01-x',
    CLAUDE_WORKSPACE: 'default',
    CLOUDFLARE_BILLING_TOKEN: 'cf',
    CLOUDFLARE_ACCOUNT_ID: 'acc-1',
    RESEND_API_KEY: 're_x',
    RESEND_PLAN: 'free',
    SUPABASE_PAT: 'sbp_x',
    SUPABASE_ORG_SLUG: 'org-1',
    ADMOB_CLIENT_ID: 'client-1',
    ADMOB_CLIENT_SECRET: 'secret-1',
    ADMOB_REFRESH_TOKEN: 'refresh-1',
    ADMOB_PUBLISHER_ID: 'pub-1',
    ADMOB_APP_ID: 'ca-app-pub-1~2',
  };

  const NOW = '2026-12-01T06:00:00Z';

  /** 対象期間の全日にレコードがある定常状態を前提に、1 回の実行の見積もりを出す。 */
  function estimateTrigger(trigger: (typeof COLLECTION_TRIGGERS)[number]): number {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const sources = [
      ...buildCostSources(FULL_ENV, { fetchImpl }),
      ...buildRevenueSources(FULL_ENV, { fetchImpl }),
    ];

    const perRun = sources.reduce((total, source) => total + (source.requestsPerRun ?? 0), 0);

    // 定常状態では対象期間の全日にレートが記録済みのため、再収集では取得し直さない。
    const dates = recollectionDates(NOW, trigger.slice);
    const recollection = dates.reduce(
      (total, date) => total + estimateRequests(sources, date, NOW, { fetchesRate: false }),
      0,
    );

    // 前日は新しく収集するため、レートを取得する。
    const previousDay = trigger.collectPreviousDay
      ? estimateRequests(sources, recollectionDates(NOW, { from: 1, to: 1 })[0]!, NOW)
      : 0;

    return perRun + recollection + previousDay;
  }

  it('定常状態の見積もりが予算に収まる', () => {
    for (const trigger of COLLECTION_TRIGGERS) {
      expect(estimateTrigger(trigger)).toBeLessThanOrEqual(REQUEST_BUDGET);
    }
  });

  it('予算が実行環境の上限を下回る', () => {
    // 無料プランの上限は 1 回の実行あたり 50 件。予算には余裕を残す。
    expect(REQUEST_BUDGET).toBeLessThan(50);
  });
});
