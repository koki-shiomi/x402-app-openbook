import { beforeEach, describe, expect, it } from 'vitest';

import { sha256Hex } from '@openbook/shared';

import { ANCHOR_CHAIN_ID, ANCHOR_CONTRACT } from '../src/config.js';
import { renderVerification } from '../src/verification-view.js';
import { verify } from '../src/verification.js';
import type { AnchorHeaders } from '../src/purchase.js';

/**
 * 判定の根拠の表示の確認。
 *
 * 結果だけを示しても、利用者は自分で確かめ直せない。算出した値と照会先を示して
 * 初めて、手順書どおりに追試できる。詳細は specs/public-dashboard/spec.md の
 * 「取得したバイト列の検証」を参照。
 */

const BODY = '{"date":"2026-09-14","revision":1}';

/** 指定した刻印を返す照会。 */
function readerReturning(hash: string, latest: number) {
  return {
    chainId: ANCHOR_CHAIN_ID,
    contractAddress: ANCHOR_CONTRACT,
    async hashOf() {
      return hash as `0x${string}`;
    },
    async latestRevisionOf() {
      return latest;
    },
  };
}

const MATCHING_HEADERS: AnchorHeaders = {
  revision: 1,
  hash: '0x0',
  chainId: ANCHOR_CHAIN_ID,
  contract: ANCHOR_CONTRACT,
};

let container: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '';
  container = document.createElement('div');
  document.body.append(container);
});

describe('判定の根拠の表示', () => {
  it('算出したハッシュとチェーン上のハッシュが示される', async () => {
    const bytes = new TextEncoder().encode(BODY);
    const hash = await sha256Hex(bytes);
    const result = await verify(bytes, readerReturning(hash, 1));

    renderVerification(container, result, { ...MATCHING_HEADERS, hash });

    const evidence = container.querySelector('[data-testid="evidence"]');
    expect(evidence?.textContent).toContain(hash);
  });

  it('照会先のチェーンとコントラクトが示される', async () => {
    const bytes = new TextEncoder().encode(BODY);
    const result = await verify(bytes, readerReturning(await sha256Hex(bytes), 1));

    renderVerification(container, result, MATCHING_HEADERS);

    const evidence = container.querySelector('[data-testid="evidence"]');
    expect(evidence?.textContent).toContain(String(ANCHOR_CHAIN_ID));
    expect(evidence?.textContent).toContain(ANCHOR_CONTRACT);
  });

  it('分類が表示される', async () => {
    const bytes = new TextEncoder().encode(BODY);
    const result = await verify(bytes, readerReturning(await sha256Hex(bytes), 1));

    renderVerification(container, result, MATCHING_HEADERS);

    expect(container.querySelector('[data-testid="status"]')?.textContent).toContain('現行');
  });

  it('不一致が分かる形で表示される', async () => {
    const bytes = new TextEncoder().encode(BODY);
    const result = await verify(bytes, readerReturning(await sha256Hex(new TextEncoder().encode('{}')), 1));

    renderVerification(container, result, MATCHING_HEADERS);

    expect(container.querySelector('[data-testid="status"]')?.textContent).toContain('不一致');
  });
});

describe('照会先の食い違いの表示', () => {
  it('食い違いがあればその旨と両方の値が示される', async () => {
    const bytes = new TextEncoder().encode(BODY);
    const result = await verify(bytes, readerReturning(await sha256Hex(bytes), 1));

    renderVerification(container, result, {
      ...MATCHING_HEADERS,
      contract: '0x0000000000000000000000000000000000000001',
    });

    const mismatch = container.querySelector('[data-testid="source-mismatch"]');
    expect(mismatch).not.toBeNull();
    expect(mismatch?.textContent).toContain(ANCHOR_CONTRACT);
    expect(mismatch?.textContent).toContain('0x0000000000000000000000000000000000000001');
  });

  it('一致していれば食い違いの節を出さない', async () => {
    const bytes = new TextEncoder().encode(BODY);
    const result = await verify(bytes, readerReturning(await sha256Hex(bytes), 1));

    renderVerification(container, result, MATCHING_HEADERS);

    expect(container.querySelector('[data-testid="source-mismatch"]')).toBeNull();
  });
});
