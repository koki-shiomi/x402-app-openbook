import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mount } from '../src/app.js';

/**
 * 支払いなしで見られる範囲の確認。
 *
 * 一覧は金額を含めない。金額を支払いなしで示すと、有料 API が金額を有料と
 * している前提が画面側から崩れる。詳細は specs/public-dashboard/spec.md の
 * 「支払いなしで見られる範囲」を参照。
 */

/** 一覧だけを返す取得関数。 */
function stubFetch(records: { date: string; revision: number }[]) {
  return vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).endsWith('/v1/records')) {
      return new Response(JSON.stringify({ records }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('{}', { status: 404 });
  }) as unknown as typeof fetch;
}

const RECORDS = [
  { date: '2026-09-15', revision: 1 },
  { date: '2026-09-14', revision: 2 },
  { date: '2026-09-13', revision: 1 },
];

let container: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '';
  container = document.createElement('div');
  document.body.append(container);
});

describe('取得可能な対象日の一覧', () => {
  it('対象日の降順で表示される', async () => {
    await mount(container, { fetchImpl: stubFetch(RECORDS) });

    const dates = [...container.querySelectorAll('[data-testid="record-date"]')].map(
      (node) => node.textContent,
    );

    expect(dates).toEqual(['2026-09-15', '2026-09-14', '2026-09-13']);
  });

  it('リビジョン番号が表示される', async () => {
    await mount(container, { fetchImpl: stubFetch(RECORDS) });

    const revisions = [...container.querySelectorAll('[data-testid="record-revision"]')].map(
      (node) => node.textContent,
    );

    expect(revisions).toEqual(['1', '2', '1']);
  });

  it('金額がどこにも表示されない', async () => {
    await mount(container, { fetchImpl: stubFetch(RECORDS) });

    // 通貨の記号と、金額を思わせる小数の並びが現れないことを確かめる。
    expect(container.textContent).not.toMatch(/[¥$]|\d+\.\d{2}/);
  });

  it('刻印が 1 件もなければ、その旨が表示される', async () => {
    await mount(container, { fetchImpl: stubFetch([]) });

    expect(container.textContent).toContain('取得できる日がありません');
  });
});
