import { describe, expect, it, vi } from 'vitest';

import { buildCostSources, buildRevenueSources } from '../../src/sources/index.js';
import type { CollectionSource } from '../../src/batch.js';

/**
 * 収集ソースが宣言する問い合わせ回数と、実際の呼び出し回数の一致。
 *
 * 宣言は、定期実行ごとの担当範囲が 1 回の実行で使える回数に収まるかを事前に
 * 判断するために用いる。実際より少ない宣言は、収まるという誤った判断を導き、
 * 担当日の一部が予算に達して収集されないまま失敗として現れずに終わる。
 * 詳細は specs/daily-batch/spec.md の「問い合わせ回数の宣言と実際の一致」を参照。
 */

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

/** 1 回目の対象日と 2 回目の対象日。いずれも前日で、遡及可能期間に収まる。 */
const FIRST_DATE = '2026-09-08';
const SECOND_DATE = '2026-09-07';

/** Supabase の組織が持つプロジェクトの数を変えられるようにする。 */
interface StubOptions {
  supabaseProjects?: number;
}

/**
 * すべての提供元へ応答を返すフェッチ関数を作る。
 *
 * 回数だけを見るため、応答は収集が成立する最小限の形にとどめる。
 *
 * @param options スタブの設定
 * @returns フェッチ関数と、呼び出された URL の記録
 */
function stubFetch(options: StubOptions = {}) {
  const calls: string[] = [];

  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);

    /** JSON を 200 で返す。 */
    const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      return ok({ access_token: 'at-1', expires_in: 3599, token_type: 'Bearer' });
    }

    if (url.startsWith('https://admob.googleapis.com/v1')) {
      if (url.includes('networkReport:generate')) {
        return ok([
          { header: { dateRange: {}, localizationSettings: { currencyCode: 'JPY' } } },
          { footer: { matchingRowCount: '0' } },
        ]);
      }

      return ok({
        name: 'accounts/pub-1',
        publisherId: 'pub-1',
        reportingTimeZone: 'Asia/Tokyo',
        currencyCode: 'JPY',
      });
    }

    if (url.startsWith('https://api.anthropic.com')) {
      return ok({ data: [] });
    }

    if (url.startsWith('https://api.resend.com')) {
      return ok({ data: [] });
    }

    if (url.startsWith('https://api.cloudflare.com')) {
      return ok({ result: [], success: true });
    }

    if (url.startsWith('https://api.supabase.com')) {
      if (url.includes('/organizations/')) {
        return ok({ id: 'org-1', name: 'sizet', plan: 'free' });
      }
      if (url.includes('/billing/addons')) {
        return ok({ selected_addons: [] });
      }

      const count = options.supabaseProjects ?? 2;
      return ok(
        Array.from({ length: count }, (_, index) => ({
          ref: `p${index + 1}`,
          organization_slug: 'org-1',
          name: `project-${index + 1}`,
        })),
      );
    }

    return new Response('{}', { status: 404 });
  }) as unknown as typeof fetch;

  return { fetchImpl, calls };
}

/**
 * 識別子を指定して収集ソースを 1 つ組み立てる。
 *
 * @param id 取得元の識別子
 * @param options スタブの設定
 * @returns 収集ソースと、呼び出された URL の記録
 */
function buildSource(id: string, options: StubOptions = {}) {
  const { fetchImpl, calls } = stubFetch(options);
  const sources = [
    ...buildCostSources(FULL_ENV, { fetchImpl }),
    ...buildRevenueSources(FULL_ENV, { fetchImpl }),
  ];
  const source = sources.find((candidate) => candidate.id === id);

  if (source === undefined) {
    throw new Error(`収集ソースが見つかりません: ${id}`);
  }

  return { source, calls };
}

/** 検証の対象とする取得元。設定が欠けている取得元は対象にしない。 */
const SOURCE_IDS = ['claude', 'cloudflare', 'resend', 'supabase', 'admob'] as const;

describe('宣言と実際の一致', () => {
  it.each(SOURCE_IDS)('%s の 1 回目の収集が宣言どおりの回数である', async (id) => {
    const { source, calls } = buildSource(id);
    const declared = declaredCounts(source);

    await source.collect(FIRST_DATE);

    expect(calls).toHaveLength(declared.perCollection + declared.perRun);
  });

  it.each(SOURCE_IDS)('%s の 2 回目の収集の増分が宣言どおりである', async (id) => {
    const { source, calls } = buildSource(id);
    const declared = declaredCounts(source);

    await source.collect(FIRST_DATE);
    const afterFirst = calls.length;
    await source.collect(SECOND_DATE);

    // 実行ごとに 1 回だけ行う取得が、2 回目の収集で再び行われないこと。
    expect(calls.length - afterFirst).toBe(declared.perCollection);
  });
});

describe('回数が変わる取得の不在', () => {
  it('Supabase のプロジェクト数が変わっても問い合わせ回数は同じである', async () => {
    const one = buildSource('supabase', { supabaseProjects: 1 });
    const many = buildSource('supabase', { supabaseProjects: 5 });

    await one.source.collect(FIRST_DATE);
    await many.source.collect(FIRST_DATE);

    expect(many.calls).toHaveLength(one.calls.length);
  });
});

/**
 * 収集ソースが宣言した回数を取り出す。
 *
 * @param source 収集ソース
 * @returns 1 回の収集あたりと 1 回の実行あたりの宣言
 */
function declaredCounts(source: CollectionSource): { perCollection: number; perRun: number } {
  return {
    perCollection: source.requestsPerCollection,
    perRun: source.requestsPerRun ?? 0,
  };
}
