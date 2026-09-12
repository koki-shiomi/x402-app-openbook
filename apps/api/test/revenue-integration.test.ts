import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { canonicalize, validateRecord, type DailyRecord } from '@openbook/shared';

import { runDaily } from '../src/batch.js';
import { recollectCurrentMonth } from '../src/schedule.js';
import { buildCostSources, buildRevenueSources } from '../src/sources/index.js';
import { getRecord } from '../src/storage.js';

const decoder = new TextDecoder();

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

const RATE = {
  pair: 'USD/JPY',
  rate: '147.25',
  provider: 'frankfurter',
  publishedOn: '2026-09-08',
  fetchedAt: '2026-09-09T06:00:00Z',
};

/** 全提供元の応答を模す。 */
function stubProviders(
  options: { currency?: string; micros?: string; tokenFails?: boolean } = {},
) {
  const currency = options.currency ?? 'JPY';
  const routes: Record<string, unknown> = {
    cost_report: { data: [] },
    subscriptions: { result: [], success: true },
    'billable-usage': { result: [], success: true },
    'billing/history': { result: [], success: true },
    'emails/metrics': { data: [{ period: '2026-09-08', sent: 0 }] },
    '/v1/organizations/org-1': { id: 'org-1', plan: 'free' },
    '/v1/projects': [{ ref: 'p1', organization_slug: 'org-1' }],
    'billing/addons': { selected_addons: [] },
    'oauth2.googleapis.com/token': { access_token: 'at-1', expires_in: 3599 },
    'networkReport:generate': [
      { header: { localizationSettings: { currencyCode: currency } } },
      {
        row: {
          dimensionValues: { DATE: { value: '20260908' }, FORMAT: { value: 'banner' } },
          metricValues: { ESTIMATED_EARNINGS: { microsValue: options.micros ?? '208376' } },
        },
      },
      { footer: { matchingRowCount: '1' } },
    ],
    '/accounts/pub-1': {
      name: 'accounts/pub-1',
      publisherId: 'pub-1',
      reportingTimeZone: 'Asia/Tokyo',
      currencyCode: currency,
    },
  };

  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);

    if (options.tokenFails === true && url.includes('oauth2.googleapis.com/token')) {
      return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
    }

    const key = Object.keys(routes)
      .sort((a, b) => b.length - a.length)
      .find((route) => url.includes(route));

    return key === undefined
      ? new Response('{}', { status: 404 })
      : new Response(JSON.stringify(routes[key]), { status: 200 });
  }) as unknown as typeof fetch;
}

const OPTIONS = { now: '2026-09-09T06:00:00Z', fetchRate: async () => RATE };

beforeEach(async () => {
  const listed = await env.RECORDS.list();
  await Promise.all(listed.objects.map((object) => env.RECORDS.delete(object.key)));
});

/**
 * 対象日の最新リビジョンを読み出す。
 *
 * @param date 対象日
 * @returns 最新リビジョンのレコード
 */
async function latest(date: string): Promise<DailyRecord> {
  return JSON.parse(decoder.decode((await getRecord(env.RECORDS, date))!)) as DailyRecord;
}

describe('既存のレコードへの収益の追加', () => {
  it('費用のみのレコードがある日を再収集すると収益が加わる', async () => {
    const fetchImpl = stubProviders();
    await runDaily(env.RECORDS, buildCostSources(FULL_ENV, { fetchImpl }), '2026-09-08', OPTIONS);

    const before = await latest('2026-09-08');
    expect(before.revenues).toEqual([]);

    await recollectCurrentMonth(
      env.RECORDS,
      [
        ...buildCostSources(FULL_ENV, { fetchImpl }),
        ...buildRevenueSources(FULL_ENV, { fetchImpl }),
      ],
      { ...OPTIONS, now: '2026-09-10T06:00:00Z' },
    );

    const after = await latest('2026-09-08');
    expect(after.revision).toBe(2);
    expect(after.correction).toMatchObject({ supersedes: 1 });
    expect(after.revenues).toEqual([
      expect.objectContaining({ source: 'admob', category: 'banner', amountJpy: '0.21' }),
    ]);
    expect(after.totals.revenueJpy).toBe('0.21');
  });
});

describe('リフレッシュトークンが失効している場合', () => {
  it('AdMob が再発行の必要とともに欠測になり、費用は記録される', async () => {
    const fetchImpl = stubProviders({ tokenFails: true });
    const sources = [
      ...buildCostSources(FULL_ENV, { fetchImpl }),
      ...buildRevenueSources(FULL_ENV, { fetchImpl }),
    ];

    await runDaily(env.RECORDS, sources, '2026-09-08', OPTIONS);

    const record = await latest('2026-09-08');
    expect(record.revenues).toEqual([]);
    expect(record.incomplete).toContainEqual(
      expect.objectContaining({
        kind: 'source',
        id: 'admob',
        reason: expect.stringMatching(/再発行/),
      }),
    );
    expect(record.costs).toHaveLength(3);
    expect(record.totals.incomplete).toBe(true);
  });
});

describe('USD 建てのアカウント', () => {
  it('収益がレコードの為替レートで JPY へ換算される', async () => {
    const fetchImpl = stubProviders({ currency: 'USD', micros: '6500000' });
    const sources = [
      ...buildCostSources(FULL_ENV, { fetchImpl }),
      ...buildRevenueSources(FULL_ENV, { fetchImpl }),
    ];

    await runDaily(env.RECORDS, sources, '2026-09-08', OPTIONS);

    const bytes = (await getRecord(env.RECORDS, '2026-09-08'))!;
    const record = JSON.parse(decoder.decode(bytes)) as DailyRecord;

    expect(record.revenues[0]).toMatchObject({
      source: 'admob',
      currency: 'USD',
      amount: '6.500000',
      exchangeRate: '147.25',
      amountJpy: '957.13',
    });
    expect(record.totals.revenueJpy).toBe('957.13');
    expect(validateRecord(record)).toEqual([]);
    expect(canonicalize(record)).toEqual(bytes);
  });
});
