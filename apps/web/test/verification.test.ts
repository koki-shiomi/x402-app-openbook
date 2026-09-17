import { describe, expect, it, vi } from 'vitest';

import { sha256Hex } from '@openbook/shared';

import { ANCHOR_CHAIN_ID, ANCHOR_CONTRACT } from '../src/config.js';
import { verify, compareWithHeaders } from '../src/verification.js';
import type { AnchorHeaders } from '../src/purchase.js';

/**
 * 検証の確認。
 *
 * API が返した情報だけで照合すると、API の自己申告を確かめているにすぎない。
 * 照会先まで API から受け取ると、運営者が用意した別のコントラクトを指すことが
 * できてしまう。詳細は design.md の決定 5 を参照。
 */

const BODY = '{"date":"2026-09-14","revision":1}';

/** 指定した刻印を返す照会。呼ばれた引数を記録する。 */
function readerReturning(hash: string, latest: number) {
  const calls: { date: number; revision?: number }[] = [];

  return {
    calls,
    reader: {
      chainId: ANCHOR_CHAIN_ID,
      contractAddress: ANCHOR_CONTRACT,
      async hashOf(date: number, revision: number) {
        calls.push({ date, revision });
        return hash as `0x${string}`;
      },
      async latestRevisionOf(date: number) {
        calls.push({ date });
        return latest;
      },
    },
  };
}

describe('取得したバイト列の検証', () => {
  it('刻印済みのバイト列が「現行」と判定される', async () => {
    const bytes = new TextEncoder().encode(BODY);
    const { reader } = readerReturning(await sha256Hex(bytes), 1);

    const result = await verify(bytes, reader);

    expect(result.kind).toBe('classified');
    expect(result.kind === 'classified' && result.status).toBe('current');
  });

  it('訂正された古いバイト列が「履歴」と判定される', async () => {
    const bytes = new TextEncoder().encode(BODY);
    const { reader } = readerReturning(await sha256Hex(bytes), 2);

    const result = await verify(bytes, reader);

    expect(result.kind === 'classified' && result.status).toBe('superseded');
  });

  it('書き換えられたバイト列が「不一致」と判定される', async () => {
    const bytes = new TextEncoder().encode(BODY);
    const { reader } = readerReturning(await sha256Hex(new TextEncoder().encode('{}')), 1);

    const result = await verify(bytes, reader);

    expect(result.kind === 'classified' && result.status).toBe('mismatched');
  });

  it('照会に用いる対象日が本文から取られる', async () => {
    const bytes = new TextEncoder().encode(BODY);
    const { reader, calls } = readerReturning(await sha256Hex(bytes), 1);

    await verify(bytes, reader);

    // 2026-09-14 を整数で表した値。
    expect(calls.every((call) => call.date === 20260914)).toBe(true);
  });
});

describe('照会先の出どころ', () => {
  it('API の応答ヘッダを判定の根拠に用いない', async () => {
    const bytes = new TextEncoder().encode(BODY);
    const realHash = await sha256Hex(bytes);
    const { reader } = readerReturning(realHash, 1);

    // API が偽の刻印情報を返しても、判定はチェーンの照会結果で行う。
    const headers: AnchorHeaders = {
      revision: 99,
      hash: '0xdeadbeef',
      chainId: 1,
      contract: '0x0000000000000000000000000000000000000001',
    };

    const result = await verify(bytes, reader);

    expect(result.kind === 'classified' && result.status).toBe('current');
    expect(result.kind === 'classified' && result.evidence.chainId).toBe(ANCHOR_CHAIN_ID);
    expect(result.kind === 'classified' && result.evidence.contractAddress).toBe(ANCHOR_CONTRACT);
    // ヘッダの値は判定に混ざらない。
    expect(JSON.stringify(result)).not.toContain('0xdeadbeef');
    void headers;
  });

  it('画面の照会先と API が示す値の食い違いを検出する', () => {
    const headers: AnchorHeaders = {
      revision: 1,
      hash: '0xabc',
      chainId: 1,
      contract: '0x0000000000000000000000000000000000000001',
    };

    const diff = compareWithHeaders(headers);

    expect(diff.matches).toBe(false);
    expect(diff.differences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'chainId' }),
        expect.objectContaining({ field: 'contract' }),
      ]),
    );
  });

  it('一致していれば食い違いを報告しない', () => {
    const headers: AnchorHeaders = {
      revision: 1,
      hash: '0xabc',
      chainId: ANCHOR_CHAIN_ID,
      contract: ANCHOR_CONTRACT,
    };

    expect(compareWithHeaders(headers).matches).toBe(true);
  });
});
