import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mount } from '../src/app.js';

/**
 * 購入の前に示す断りの確認。
 *
 * 有料 API は利用者を識別せず、支払い 1 回につき取得 1 回である。保存しないため
 * 同じ日を再び表示するには再び支払う必要がある。これを購入の前に示さなければ、
 * 利用者は意図せず二重に支払う。詳細は specs/public-dashboard/spec.md の
 * 「取得した内容を保存しない」を参照。
 */

/** 一覧を 1 件返す取得関数。 */
const stubFetch = vi.fn(async (input: RequestInfo | URL) => {
  if (String(input).endsWith('/v1/records')) {
    return new Response(JSON.stringify({ records: [{ date: '2026-09-15', revision: 1 }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  return new Response('{}', { status: 404 });
}) as unknown as typeof fetch;

let container: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '';
  container = document.createElement('div');
  document.body.append(container);
});

describe('購入の前の断り', () => {
  it('保存されないことが購入の操作の前に表示される', async () => {
    await mount(container, { fetchImpl: stubFetch });

    const notice = container.querySelector('[data-testid="ephemeral-notice"]');

    expect(notice?.textContent).toContain('保存しません');
    expect(notice?.textContent).toContain('再び支払い');
  });

  it('断りが購入の操作より前に置かれている', async () => {
    await mount(container, { fetchImpl: stubFetch });

    const notice = container.querySelector('[data-testid="ephemeral-notice"]');
    const buy = container.querySelector('[data-testid="buy"]');

    expect(notice).not.toBeNull();
    expect(buy).not.toBeNull();
    // 文書の順序で断りが先に現れる。
    expect(notice!.compareDocumentPosition(buy!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('この画面が API の内容を確かめるためのものである旨が示される', async () => {
    await mount(container, { fetchImpl: stubFetch });

    expect(container.textContent).toContain('API');
  });
});
