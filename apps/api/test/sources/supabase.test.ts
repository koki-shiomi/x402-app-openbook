import { describe, expect, it, vi } from 'vitest';

import { createSupabaseSource } from '../../src/sources/supabase.js';

const CONFIG = { pat: 'sbp_x', orgSlug: 'org-1' };
const NOW = '2026-09-09T06:00:00Z';

/** URL ごとに応答を返すフェッチ関数を作る。 */
function stubFetch(routes: Record<string, unknown>) {
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    // 部分一致では /v1/projects が addons の URL にも当たるため、
    // より具体的な（長い）ルートを優先する。
    const key = Object.keys(routes)
      .sort((a, b) => b.length - a.length)
      .find((route) => url.includes(route));
    return key === undefined
      ? new Response('{}', { status: 404 })
      : new Response(JSON.stringify(routes[key]), { status: 200 });
  }) as unknown as typeof fetch;

  return { fetchImpl, calls };
}

/** 実測した無料プランの応答。 */
const FREE_TIER = {
  '/v1/projects': [
    { ref: 'p1', organization_slug: 'org-1', name: 'sizet' },
    { ref: 'p2', organization_slug: 'org-1', name: 'sizet-alt' },
  ],
  '/v1/organizations/org-1': { id: 'org-1', name: 'sizet', plan: 'free' },
  '/billing/addons': { selected_addons: [] },
};

describe('無料プランかつアドオンなし', () => {
  it('金額 0 の estimated エントリになる', async () => {
    const { fetchImpl } = stubFetch(FREE_TIER);
    const source = createSupabaseSource(CONFIG, { fetchImpl });

    const [entry] = (await source.collect('2026-09-08')).costs;

    expect(entry).toMatchObject({
      source: 'supabase',
      acquisition: 'estimated',
      revisable: false,
      currency: 'JPY',
      amount: '0.00',
      amountJpy: '0.00',
    });
  });

  it('プラン名とアドオンの確認結果が算出根拠に含まれる', async () => {
    const { fetchImpl } = stubFetch(FREE_TIER);
    const source = createSupabaseSource(CONFIG, { fetchImpl });

    const [entry] = (await source.collect('2026-09-08')).costs;

    expect(entry?.basis?.plan).toBe('free');
    expect(entry?.basis?.description).toMatch(/アドオン/);
  });
});

describe('費用が発生している場合', () => {
  it('有料プランなら 0 円として記録しない', async () => {
    const { fetchImpl } = stubFetch({
      ...FREE_TIER,
      '/v1/organizations/org-1': { id: 'org-1', name: 'sizet', plan: 'pro' },
    });
    const source = createSupabaseSource(CONFIG, { fetchImpl });

    await expect(source.collect('2026-09-08')).rejects.toThrow(/プラン/);
  });

  it('課金アドオンが適用されていれば 0 円として記録しない', async () => {
    const { fetchImpl } = stubFetch({
      ...FREE_TIER,
      '/billing/addons': {
        selected_addons: [{ type: 'compute_instance', variant: { id: 'ci_micro' } }],
      },
    });
    const source = createSupabaseSource(CONFIG, { fetchImpl });

    await expect(source.collect('2026-09-08')).rejects.toThrow(/アドオン/);
  });
});

describe('過去日の扱い', () => {
  it('当日および前日は取得可能と判定される', () => {
    const source = createSupabaseSource(CONFIG, {});

    expect(source.canCollect?.('2026-09-08', NOW)).toBe(true);
    expect(source.canCollect?.('2026-09-09', NOW)).toBe(true);
  });

  it('それより前の対象日は取得できないと判定される', () => {
    const source = createSupabaseSource(CONFIG, {});

    expect(source.canCollect?.('2026-09-07', NOW)).toBe(false);
    expect(source.canCollect?.('2026-08-01', NOW)).toBe(false);
  });
});

describe('生応答の保存', () => {
  it('プランとアドオンの応答をまとめて返す', async () => {
    const { fetchImpl } = stubFetch(FREE_TIER);
    const source = createSupabaseSource(CONFIG, { fetchImpl });

    const raw = (await source.collect('2026-09-08')).raw as Record<string, unknown>;

    expect(Object.keys(raw).sort()).toEqual(['addons', 'organization']);
  });
});
