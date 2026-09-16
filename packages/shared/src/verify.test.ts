import { describe, expect, it } from 'vitest';

import { sha256Hex, type HexHash } from './hash.js';
import { verifyAnchoredRecord, ZERO_HASH, type AnchorReader } from './verify.js';

const encoder = new TextEncoder();

const CONTRACT = '0xC039722204Dde6DF3dFb48a9a3068163d30b997a';
const CHAIN_ID = 5042002;

/** 対象日とリビジョンを与えてレコードのバイト列を作る。 */
function recordBytes(date = '2026-09-13', revision = 2, amount = '12.00'): Uint8Array {
  return encoder.encode(
    `{"date":"${date}","revision":${revision},"totals":{"revenueJpy":"${amount}"}}`,
  );
}

/** チェーン上の値だけを返す照会。刻印は (対象日, リビジョン) → ハッシュ で与える。 */
function chainReader(anchors: Record<string, HexHash>): AnchorReader {
  return {
    chainId: CHAIN_ID,
    contractAddress: CONTRACT,
    async hashOf(date, revision) {
      return anchors[`${date}/${revision}`] ?? ZERO_HASH;
    },
    async latestRevisionOf(date) {
      const revisions = Object.keys(anchors)
        .filter((key) => key.startsWith(`${date}/`))
        .map((key) => Number(key.split('/')[1]));

      return revisions.length === 0 ? 0 : Math.max(...revisions);
    },
  };
}

describe('刻印の検証', () => {
  it('最大のリビジョンと一致すれば現行と判定する', async () => {
    const bytes = recordBytes('2026-09-13', 2);
    const reader = chainReader({
      '20260913/1': '0x1111111111111111111111111111111111111111111111111111111111111111',
      '20260913/2': await sha256Hex(bytes),
    });

    const result = await verifyAnchoredRecord(bytes, reader);

    expect(result).toMatchObject({ kind: 'classified', status: 'current' });
  });

  it('最大のリビジョンより小さければ履歴と判定する', async () => {
    const older = recordBytes('2026-09-13', 1, '10.00');
    const reader = chainReader({
      '20260913/1': await sha256Hex(older),
      '20260913/2': '0x2222222222222222222222222222222222222222222222222222222222222222',
    });

    const result = await verifyAnchoredRecord(older, reader);

    expect(result).toMatchObject({ kind: 'classified', status: 'superseded' });
  });

  it('刻印がなければ未刻印と判定する', async () => {
    const bytes = recordBytes('2026-09-13', 3);
    const reader = chainReader({ '20260913/2': await sha256Hex(recordBytes()) });

    const result = await verifyAnchoredRecord(bytes, reader);

    expect(result).toMatchObject({ kind: 'classified', status: 'unanchored' });
  });

  it('刻印後にバイト列が変わっていれば不一致と判定する', async () => {
    const anchored = recordBytes('2026-09-13', 2, '12.00');
    const tampered = recordBytes('2026-09-13', 2, '12.01');
    const reader = chainReader({ '20260913/2': await sha256Hex(anchored) });

    const result = await verifyAnchoredRecord(tampered, reader);

    expect(result).toMatchObject({ kind: 'classified', status: 'mismatched' });
  });

  it('空白だけが異なるバイト列は不一致と判定する', async () => {
    const anchored = recordBytes('2026-09-13', 2);
    const respaced = encoder.encode(new TextDecoder().decode(anchored).replace(/,/g, ', '));
    const reader = chainReader({ '20260913/2': await sha256Hex(anchored) });

    const result = await verifyAnchoredRecord(respaced, reader);

    expect(result).toMatchObject({ kind: 'classified', status: 'mismatched' });
  });

  it('判定の根拠を返す', async () => {
    const bytes = recordBytes('2026-09-13', 2);
    const computed = await sha256Hex(bytes);
    const reader = chainReader({ '20260913/2': computed });

    const result = await verifyAnchoredRecord(bytes, reader);

    expect(result).toEqual({
      kind: 'classified',
      status: 'current',
      evidence: {
        date: '2026-09-13',
        revision: 2,
        computedHash: computed,
        anchoredHash: computed,
        latestRevision: 2,
        contractAddress: CONTRACT,
        chainId: CHAIN_ID,
      },
    });
  });

  it('運営者の記録や API を参照せず、照会だけで判定する', async () => {
    const bytes = recordBytes('2026-09-13', 2);
    const reader = chainReader({ '20260913/2': await sha256Hex(bytes) });

    const original = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error('検証は照会以外の通信を行ってはならない');
    }) as typeof fetch;

    try {
      const result = await verifyAnchoredRecord(bytes, reader);
      expect(result).toMatchObject({ kind: 'classified', status: 'current' });
    } finally {
      globalThis.fetch = original;
    }

    // 引数はバイト列と照会の 2 つだけで、運営者の記録を受け取らない。
    expect(verifyAnchoredRecord.length).toBe(2);
  });
});

describe('検証できないバイト列', () => {
  const reader = chainReader({});

  it('JSON として解析できなければ理由を返す', async () => {
    const result = await verifyAnchoredRecord(encoder.encode('not json'), reader);

    expect(result.kind).toBe('unverifiable');
    expect(result).toMatchObject({ reason: expect.stringMatching(/解析/) });
  });

  it('対象日を持たなければ理由を返す', async () => {
    const result = await verifyAnchoredRecord(encoder.encode('{"revision":1}'), reader);

    expect(result.kind).toBe('unverifiable');
    expect(result).toMatchObject({ reason: expect.stringMatching(/対象日/) });
  });

  it('対象日が実在する暦日でなければ理由を返す', async () => {
    const result = await verifyAnchoredRecord(
      encoder.encode('{"date":"2026-02-30","revision":1}'),
      reader,
    );

    expect(result).toMatchObject({ kind: 'unverifiable', reason: expect.stringMatching(/対象日/) });
  });

  it('リビジョン番号を持たなければ理由を返す', async () => {
    const result = await verifyAnchoredRecord(encoder.encode('{"date":"2026-09-13"}'), reader);

    expect(result).toMatchObject({
      kind: 'unverifiable',
      reason: expect.stringMatching(/リビジョン/),
    });
  });
});
