import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DailyRecord } from '@openbook/shared';

import { runDaily } from '../../src/batch.js';
import { recollectRecent } from '../../src/schedule.js';
import { buildCostSources, buildRevenueSources } from '../../src/sources/index.js';
import { readRun } from '../../src/runlog.js';
import { getRecord } from '../../src/storage.js';

const decoder = new TextDecoder();

/** 全提供元が無料枠内を返すフェッチ関数。 */
function stubAllProviders() {
  const calls: string[] = [];
  const routes: Record<string, unknown> = {
    'cost_report': {
      data: [
        {
          starting_at: '2026-09-08T00:00:00Z',
          results: [
            {
              currency: 'USD',
              amount: '1.0071',
              workspace_id: null,
              description: 'Claude Haiku 4.5 - Input Tokens',
            },
          ],
        },
      ],
    },
    'subscriptions': { result: [], success: true },
    'billable-usage': { result: [], success: true },
    'billing/history': { result: [], success: true },
    'emails/metrics': { data: [{ period: '2026-09-08', sent: 5 }] },
    '/v1/organizations/org-1': { id: 'org-1', plan: 'free' },
    '/v1/projects': [{ ref: 'p1', organization_slug: 'org-1' }],
    'billing/addons': { selected_addons: [] },
    'oauth2.googleapis.com/token': { access_token: 'at-1', expires_in: 3599 },
    'networkReport:generate': [
      { header: { localizationSettings: { currencyCode: 'JPY' } } },
      {
        row: {
          dimensionValues: { DATE: { value: '20260908' }, FORMAT: { value: 'banner' } },
          metricValues: { ESTIMATED_EARNINGS: { microsValue: '208376' } },
        },
      },
      { footer: { matchingRowCount: '1' } },
    ],
    '/accounts/pub-1': {
      name: 'accounts/pub-1',
      publisherId: 'pub-1',
      reportingTimeZone: 'Asia/Tokyo',
      currencyCode: 'JPY',
    },
  };

  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const key = Object.keys(routes)
      .sort((a, b) => b.length - a.length)
      .find((route) => url.includes(route));
    return key === undefined
      ? new Response('{}', { status: 404 })
      : new Response(JSON.stringify(routes[key]), { status: 200 });
  }) as unknown as typeof fetch;

  return { fetchImpl, calls };
}

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

const OPTIONS = { now: '2026-09-09T06:00:00Z', fetchRate: async () => undefined };

beforeEach(async () => {
  const listed = await env.RECORDS.list();
  await Promise.all(listed.objects.map((object) => env.RECORDS.delete(object.key)));
});

describe('収集ソースの登録', () => {
  it('設定が揃っていれば 4 提供元が登録される', () => {
    const { fetchImpl } = stubAllProviders();
    const sources = buildCostSources(FULL_ENV, { fetchImpl });

    expect(sources.map((source) => source.id).sort()).toEqual([
      'claude',
      'cloudflare',
      'resend',
      'supabase',
    ]);
  });

  it('すべての収集ソースが問い合わせ回数を宣言する', () => {
    const { fetchImpl } = stubAllProviders();
    const sources = [
      ...buildCostSources(FULL_ENV, { fetchImpl }),
      ...buildRevenueSources(FULL_ENV, { fetchImpl }),
    ];

    for (const source of sources) {
      expect(
        Number.isInteger(source.requestsPerCollection) && source.requestsPerCollection >= 0,
      ).toBe(true);
    }
  });

  it('設定が欠けている提供元は問い合わせを行わないと宣言する', () => {
    const { fetchImpl } = stubAllProviders();
    const { CLOUDFLARE_BILLING_TOKEN: _omit, ...partial } = FULL_ENV;

    const cloudflare = buildCostSources(partial, { fetchImpl }).find(
      (source) => source.id === 'cloudflare',
    );

    expect(cloudflare?.requestsPerCollection).toBe(0);
  });

  it('日次実行で 4 提供元すべてが呼び出される', async () => {
    const { fetchImpl } = stubAllProviders();
    const sources = buildCostSources(FULL_ENV, { fetchImpl });

    await runDaily(env.RECORDS, sources, '2026-09-08', OPTIONS);

    const record = JSON.parse(
      decoder.decode((await getRecord(env.RECORDS, '2026-09-08'))!),
    ) as DailyRecord;

    expect(record.costs.map((entry) => entry.source).sort()).toEqual([
      'claude',
      'cloudflare',
      'resend',
      'supabase',
    ]);
  });
});

describe('収益の収集ソースの登録', () => {
  it('日次実行で 5 提供元すべてが呼び出される', async () => {
    const { fetchImpl } = stubAllProviders();
    const sources = [
      ...buildCostSources(FULL_ENV, { fetchImpl }),
      ...buildRevenueSources(FULL_ENV, { fetchImpl }),
    ];

    await runDaily(env.RECORDS, sources, '2026-09-08', OPTIONS);

    const record = JSON.parse(
      decoder.decode((await getRecord(env.RECORDS, '2026-09-08'))!),
    ) as DailyRecord;

    expect(record.costs.map((entry) => entry.source).sort()).toEqual([
      'claude',
      'cloudflare',
      'resend',
      'supabase',
    ]);
    expect(record.revenues.map((entry) => entry.source)).toEqual(['admob']);
    // 為替レートを返さない設定のため、取得元以外の欠測は生じうる。
    expect(record.incomplete.filter((item) => item.kind === 'source')).toEqual([]);
  });

  it('AdMob が未設定なら欠測になり、他の取得元の結果は記録される', async () => {
    const { fetchImpl } = stubAllProviders();
    const { ADMOB_REFRESH_TOKEN: _omit, ...partial } = FULL_ENV;
    const sources = [
      ...buildCostSources(partial, { fetchImpl }),
      ...buildRevenueSources(partial, { fetchImpl }),
    ];

    const record = await runDaily(env.RECORDS, sources, '2026-09-08', OPTIONS);

    expect(record?.revenues).toEqual([]);
    expect(record?.incomplete).toContainEqual(
      expect.objectContaining({
        kind: 'source',
        id: 'admob',
        reason: expect.stringMatching(/ADMOB_REFRESH_TOKEN/),
      }),
    );
    expect(record?.costs).toHaveLength(4);
  });
});

describe('認証情報が未設定の提供元', () => {
  it('未設定でも収集ソースとしては登録される', () => {
    const { fetchImpl } = stubAllProviders();
    const { CLOUDFLARE_BILLING_TOKEN: _omit, ...partial } = FULL_ENV;

    expect(buildCostSources(partial, { fetchImpl }).map((s) => s.id)).toContain(
      'cloudflare',
    );
  });

  it('欠測として記録され 0 円のエントリを作らない', async () => {
    const { fetchImpl } = stubAllProviders();
    const { CLOUDFLARE_BILLING_TOKEN: _omit, ...partial } = FULL_ENV;
    const sources = buildCostSources(partial, { fetchImpl });

    const record = await runDaily(env.RECORDS, sources, '2026-09-08', OPTIONS);

    expect(record?.costs.some((entry) => entry.source === 'cloudflare')).toBe(false);
    expect(record?.incomplete).toContainEqual(
      expect.objectContaining({ kind: 'source', id: 'cloudflare' }),
    );
  });

  it('理由が欠測に記録される', async () => {
    const { fetchImpl } = stubAllProviders();
    const { SUPABASE_PAT: _omit, ...partial } = FULL_ENV;
    const sources = buildCostSources(partial, { fetchImpl });

    const record = await runDaily(env.RECORDS, sources, '2026-09-08', OPTIONS);

    const item = record?.incomplete.find((entry) => entry.id === 'supabase');
    expect(item?.reason).toMatch(/SUPABASE_PAT/);
  });
});

describe('過去日の再収集での遡及制限', () => {
  it('遡及できない提供元の日は既存値が維持され実行記録に残る', async () => {
    const { fetchImpl } = stubAllProviders();
    const sources = buildCostSources(FULL_ENV, { fetchImpl });

    await runDaily(env.RECORDS, sources, '2026-08-31', {
      ...OPTIONS,
      now: '2026-09-01T06:00:00Z',
    });

    await recollectRecent(env.RECORDS, sources, {
      ...OPTIONS,
      now: '2026-09-06T07:00:00Z',
    });

    const run = await readRun(env.RECORDS, '2026-08-31');
    const record = JSON.parse(
      decoder.decode((await getRecord(env.RECORDS, '2026-08-31'))!),
    ) as DailyRecord;

    // Supabase は前日までしか遡れないため、再収集の対象外になる。
    expect(run?.skippedSources).toContain('supabase');
    expect(record.costs.some((entry) => entry.source === 'supabase')).toBe(true);

    // Cloudflare もサブスクリプションが現在の状態しか返さないため、前日までしか遡れない。
    expect(run?.skippedSources).toContain('cloudflare');
    expect(record.costs.some((entry) => entry.source === 'cloudflare')).toBe(true);
  });
});
