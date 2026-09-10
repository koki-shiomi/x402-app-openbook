import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { canonicalize, validateRecord, type DailyRecord } from '@openbook/shared';

import { runDaily } from '../src/batch.js';
import { buildCostSources } from '../src/sources/index.js';
import { getRecord, rawKey } from '../src/storage.js';

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
};

const RATE = {
  pair: 'USD/JPY',
  rate: '147.25',
  provider: 'frankfurter',
  publishedOn: '2026-09-08',
  fetchedAt: '2026-09-09T06:00:00Z',
};

/** 全提供元の応答を模す。failing に含めた提供元は失敗させる。 */
function stubProviders(failing: string[] = []) {
  const routes: Record<string, unknown> = {
    cost_report: {
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
    subscriptions: { result: [], success: true },
    'billable-usage': { result: [], success: true },
    'billing/history': { result: [], success: true },
    'emails/metrics': { data: [{ period: '2026-09-08', sent: 5 }] },
    '/v1/organizations/org-1': { id: 'org-1', plan: 'free' },
    '/v1/projects': [{ ref: 'p1', organization_slug: 'org-1' }],
    'billing/addons': { selected_addons: [] },
  };

  const owner: Record<string, string> = {
    cost_report: 'claude',
    subscriptions: 'cloudflare',
    'billable-usage': 'cloudflare',
    'billing/history': 'cloudflare',
    'emails/metrics': 'resend',
    '/v1/organizations/org-1': 'supabase',
    '/v1/projects': 'supabase',
    'billing/addons': 'supabase',
  };

  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const key = Object.keys(routes)
      .sort((a, b) => b.length - a.length)
      .find((route) => url.includes(route));

    if (key === undefined) {
      return new Response('{}', { status: 404 });
    }
    if (failing.includes(owner[key]!)) {
      return new Response('{}', { status: 503 });
    }
    return new Response(JSON.stringify(routes[key]), { status: 200 });
  }) as unknown as typeof fetch;
}

const OPTIONS = { now: '2026-09-09T06:00:00Z', fetchRate: async () => RATE };

beforeEach(async () => {
  const listed = await env.RECORDS.list();
  await Promise.all(listed.objects.map((object) => env.RECORDS.delete(object.key)));
});

describe('実測と推定が混在するレコード', () => {
  it('バリデーションと正準表現の検証を両方通過する', async () => {
    const sources = buildCostSources(FULL_ENV, { fetchImpl: stubProviders() });

    await runDaily(env.RECORDS, sources, '2026-09-08', OPTIONS);

    const bytes = (await getRecord(env.RECORDS, '2026-09-08'))!;
    const record = JSON.parse(decoder.decode(bytes)) as DailyRecord;

    expect(validateRecord(record)).toEqual([]);
    expect(canonicalize(record)).toEqual(bytes);
  });

  it('取得方式が提供元ごとに正しく分かれる', async () => {
    const sources = buildCostSources(FULL_ENV, { fetchImpl: stubProviders() });

    await runDaily(env.RECORDS, sources, '2026-09-08', OPTIONS);

    const record = JSON.parse(
      decoder.decode((await getRecord(env.RECORDS, '2026-09-08'))!),
    ) as DailyRecord;

    const bySource = Object.fromEntries(
      record.costs.map((entry) => [entry.source, entry.acquisition]),
    );
    expect(bySource).toEqual({
      claude: 'measured',
      cloudflare: 'estimated',
      resend: 'estimated',
      supabase: 'estimated',
    });
  });

  it('USD 建ての実測費用が JPY へ換算され集計される', async () => {
    const sources = buildCostSources(FULL_ENV, { fetchImpl: stubProviders() });

    await runDaily(env.RECORDS, sources, '2026-09-08', OPTIONS);

    const record = JSON.parse(
      decoder.decode((await getRecord(env.RECORDS, '2026-09-08'))!),
    ) as DailyRecord;

    const claude = record.costs.find((entry) => entry.source === 'claude');
    expect(claude).toMatchObject({ currency: 'USD', amount: '0.010071', amountJpy: '1.48' });
    expect(record.totals.costJpy).toBe('1.48');
  });
});

describe('一部提供元の取得失敗', () => {
  it('成功分のエントリと失敗分の欠測が同時に記録される', async () => {
    const sources = buildCostSources(FULL_ENV, {
      fetchImpl: stubProviders(['resend', 'supabase']),
    });

    await runDaily(env.RECORDS, sources, '2026-09-08', OPTIONS);

    const record = JSON.parse(
      decoder.decode((await getRecord(env.RECORDS, '2026-09-08'))!),
    ) as DailyRecord;

    expect(record.costs.map((entry) => entry.source).sort()).toEqual([
      'claude',
      'cloudflare',
    ]);
    expect(record.incomplete.map((item) => item.id).sort()).toEqual([
      'resend',
      'supabase',
    ]);
    expect(record.totals.incomplete).toBe(true);
  });
});

describe('生応答の保存', () => {
  it('4 提供元それぞれの生応答が認証情報を含まずに保存される', async () => {
    const sources = buildCostSources(FULL_ENV, { fetchImpl: stubProviders() });

    await runDaily(env.RECORDS, sources, '2026-09-08', OPTIONS);

    for (const id of ['claude', 'cloudflare', 'resend', 'supabase']) {
      const stored = await env.RECORDS.get(rawKey('2026-09-08', id));
      expect(stored, `${id} の生応答`).not.toBeNull();

      const text = await stored!.text();
      expect(text.toLowerCase()).not.toContain('authorization');
      expect(text).not.toContain('sk-ant-admin01');
      expect(text).not.toContain('sbp_');
    }
  });
});
