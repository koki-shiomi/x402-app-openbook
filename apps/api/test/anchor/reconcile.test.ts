import { describe, expect, it } from 'vitest';

import { ZERO_HASH } from '@openbook/shared';

import { reconcile } from '../../src/anchor/reconcile.js';

const HASH_A = '0xaa11111111111111111111111111111111111111111111111111111111111111';
const HASH_B = '0xbb22222222222222222222222222222222222222222222222222222222222222';

/** 1 件の対象と、そのチェーン上の状態を組み立てる。 */
function target(
  revision: number,
  hash: string,
  anchoredHash: string,
  latestRevision: number,
) {
  return {
    date: '2026-09-13',
    revision,
    hash,
    chain: { anchoredHash, latestRevision },
  };
}

describe('送信前のチェーンとの突き合わせ', () => {
  it('未刻印で最大のリビジョンが対象より小さければ送信に含める', () => {
    const result = reconcile([target(2, HASH_A, ZERO_HASH, 1)]);

    expect(result.toSend).toEqual([{ date: '2026-09-13', revision: 2, hash: HASH_A }]);
    expect(result.alreadyAnchored).toEqual([]);
    expect(result.anomalies).toEqual([]);
  });

  it('同じハッシュが刻印済みなら送信に含めず刻印の結果として扱う', () => {
    const result = reconcile([target(2, HASH_A, HASH_A, 2)]);

    expect(result.toSend).toEqual([]);
    expect(result.alreadyAnchored).toEqual([{ date: '2026-09-13', revision: 2, hash: HASH_A }]);
    expect(result.anomalies).toEqual([]);
  });

  it('異なるハッシュが刻印済みなら不一致として残す', () => {
    const result = reconcile([target(2, HASH_A, HASH_B, 2)]);

    expect(result.toSend).toEqual([]);
    expect(result.alreadyAnchored).toEqual([]);
    expect(result.anomalies).toEqual([
      {
        date: '2026-09-13',
        revision: 2,
        computedHash: HASH_A,
        anchoredHash: HASH_B,
        latestRevision: 2,
        reason: '刻印されたハッシュが保存物と一致しません',
      },
    ]);
  });

  it('チェーンの最大のリビジョンが対象より大きければ不一致として残す', () => {
    const result = reconcile([target(2, HASH_A, ZERO_HASH, 5)]);

    expect(result.toSend).toEqual([]);
    expect(result.anomalies).toEqual([
      {
        date: '2026-09-13',
        revision: 2,
        computedHash: HASH_A,
        anchoredHash: ZERO_HASH,
        latestRevision: 5,
        reason: 'チェーン上の最大のリビジョンが保存物より大きい値です',
      },
    ]);
  });

  it('刻印の結果の記録が欠けている対象は、チェーンと一致すれば記録に回す', () => {
    // 前回の実行で刻印は成立したが、結果を保存できずに対象へ残ったリビジョン。
    const result = reconcile([target(3, HASH_B, HASH_B, 3)]);

    expect(result.toSend).toEqual([]);
    expect(result.alreadyAnchored).toEqual([{ date: '2026-09-13', revision: 3, hash: HASH_B }]);
  });

  it('複数の対象を種類ごとに分ける', () => {
    const result = reconcile([
      { ...target(2, HASH_A, ZERO_HASH, 1), date: '2026-09-13' },
      { ...target(1, HASH_B, HASH_B, 1), date: '2026-09-14' },
      { ...target(1, HASH_A, HASH_B, 1), date: '2026-09-15' },
    ]);

    expect(result.toSend.map((item) => item.date)).toEqual(['2026-09-13']);
    expect(result.alreadyAnchored.map((item) => item.date)).toEqual(['2026-09-14']);
    expect(result.anomalies.map((item) => item.date)).toEqual(['2026-09-15']);
  });
});
