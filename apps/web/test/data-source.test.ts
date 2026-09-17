import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mount } from '../src/app.js';

/**
 * 取得経路の確認。
 *
 * 財務データはすべて有料 API から取得する。保存物へ直接アクセスする経路や、
 * API を経由しない別の取得経路があると、公開しているデータと実際のデータが
 * 異なる余地が生まれる。詳細は specs/public-dashboard/spec.md の
 * 「取得元の限定」を参照。
 */

let container: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '';
  container = document.createElement('div');
  document.body.append(container);
});

describe('財務データの取得経路', () => {
  it('要求先が有料 API の経路だけである', async () => {
    const seen: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      seen.push(String(input));
      return new Response(JSON.stringify({ records: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    await mount(container, { fetchImpl });

    expect(seen).toEqual(['/v1/records']);
    for (const url of seen) {
      expect(url.startsWith('/v1/')).toBe(true);
    }
  });

  it('相対パスで要求する', async () => {
    const seen: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      seen.push(String(input));
      return new Response(JSON.stringify({ records: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    await mount(container, { fetchImpl });

    // 同一オリジンで配るため、別のオリジンを指さない。
    for (const url of seen) {
      expect(url).not.toMatch(/^https?:/);
    }
  });

  it('保存物の経路を指さない', async () => {
    const seen: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      seen.push(String(input));
      return new Response(JSON.stringify({ records: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    await mount(container, { fetchImpl });

    // R2 の保存物のキーに相当する経路を要求しない。
    for (const url of seen) {
      expect(url).not.toMatch(/records\/\d{4}-\d{2}-\d{2}\/|anchors\/|raw\/|runs\//);
    }
  });
});
