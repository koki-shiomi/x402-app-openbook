import { describe, expect, it, vi } from 'vitest';

import { createSupabaseSource } from '../../src/sources/supabase.js';

/**
 * Supabase の費用の裏付け。
 *
 * 課金は組織を単位として行われ、課金アドオンは有料プランのプロジェクトにのみ
 * 適用できる。組織のプランが無料であることを確認できれば、アドオンによる費用は
 * 生じない。プロジェクトごとの確認は、プロジェクト数に応じて問い合わせ回数が
 * 変わるため行わない。詳細は specs/cost-collection/spec.md の
 * 「Supabase 費用の組織プラン確認による裏付け」を参照。
 */

const CONFIG = { pat: 'sbp_x', orgSlug: 'org-1' };
const NOW = '2026-09-09T06:00:00Z';

/** 組織の応答と、必要ならプロジェクト一覧を返すフェッチ関数を作る。 */
function stubFetch(options: { plan?: string; projects?: number } = {}) {
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);

    if (url.includes('/organizations/')) {
      return new Response(
        JSON.stringify({ id: 'org-1', name: 'sizet', plan: options.plan ?? 'free' }),
        { status: 200 },
      );
    }

    if (url.includes('/billing/addons')) {
      return new Response(JSON.stringify({ selected_addons: [] }), { status: 200 });
    }

    if (url.includes('/projects')) {
      const count = options.projects ?? 2;
      return new Response(
        JSON.stringify(
          Array.from({ length: count }, (_, index) => ({
            ref: `p${index + 1}`,
            organization_slug: 'org-1',
            name: `project-${index + 1}`,
          })),
        ),
        { status: 200 },
      );
    }

    return new Response('{}', { status: 404 });
  }) as unknown as typeof fetch;

  return { fetchImpl, calls };
}

describe('無料プラン', () => {
  it('金額 0 の estimated エントリになる', async () => {
    const { fetchImpl } = stubFetch();
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

  it('プラン名が算出根拠に含まれる', async () => {
    const { fetchImpl } = stubFetch();
    const source = createSupabaseSource(CONFIG, { fetchImpl });

    const [entry] = (await source.collect('2026-09-08')).costs;

    expect(entry?.basis?.plan).toBe('free');
    expect(entry?.basis?.description).toMatch(/free/);
  });

  it('課金アドオンを問い合わせない', async () => {
    const { fetchImpl, calls } = stubFetch();
    const source = createSupabaseSource(CONFIG, { fetchImpl });

    await source.collect('2026-09-08');

    expect(calls.some((url) => url.includes('/billing/addons'))).toBe(false);
    expect(calls.some((url) => url.includes('/projects'))).toBe(false);
  });
});

describe('無料ではないプラン', () => {
  it('0 円として記録しない', async () => {
    const { fetchImpl } = stubFetch({ plan: 'pro' });
    const source = createSupabaseSource(CONFIG, { fetchImpl });

    await expect(source.collect('2026-09-08')).rejects.toThrow(/プラン/);
  });
});

describe('プロジェクト数の異なる組織', () => {
  it('問い合わせ回数が変わらない', async () => {
    const few = stubFetch({ projects: 1 });
    const many = stubFetch({ projects: 5 });

    await createSupabaseSource(CONFIG, { fetchImpl: few.fetchImpl }).collect('2026-09-08');
    await createSupabaseSource(CONFIG, { fetchImpl: many.fetchImpl }).collect('2026-09-08');

    expect(many.calls).toHaveLength(few.calls.length);
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
  it('組織の応答を返す', async () => {
    const { fetchImpl } = stubFetch();
    const source = createSupabaseSource(CONFIG, { fetchImpl });

    const raw = (await source.collect('2026-09-08')).raw as Record<string, unknown>;

    expect(Object.keys(raw)).toEqual(['organization']);
  });
});
