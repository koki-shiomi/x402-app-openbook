import { ZERO_HASH } from '@openbook/shared';

import type { AnchorTarget } from './targets.js';

/**
 * 送信前のチェーンとの突き合わせ。
 *
 * コントラクトは既存以下のリビジョンを 1 件でも含む送信を拒否するため、突き合わせを
 * せずに送ると、刻印済みの 1 件のために他の対象も刻印されなくなる。
 * 詳細は specs/hash-anchoring/spec.md を参照。
 */

/** 対象日とリビジョンに対するチェーン上の状態。 */
export interface ChainState {
  /** そのリビジョンに刻印されたハッシュ。未刻印は ZERO_HASH。 */
  anchoredHash: string;
  /** その対象日に刻印された最大のリビジョン番号。 */
  latestRevision: number;
}

/** ハッシュを算出済みの対象。 */
export interface PreparedTarget extends AnchorTarget {
  /** 保存物から算出したハッシュ。 */
  hash: string;
}

/** 保存物とチェーン上の刻印が食い違っている対象。 */
export interface AnchorAnomaly extends AnchorTarget {
  /** 保存物から算出したハッシュ。 */
  computedHash: string;
  /** チェーン上に刻印されたハッシュ。 */
  anchoredHash: string;
  /** チェーン上の最大のリビジョン番号。 */
  latestRevision: number;
  /** 食い違いの内容。 */
  reason: string;
}

/** 突き合わせの結果。 */
export interface Reconciliation {
  /** 送信に含める対象。 */
  toSend: PreparedTarget[];
  /** 既に同じハッシュが刻印済みで、結果の記録だけが必要な対象。 */
  alreadyAnchored: PreparedTarget[];
  /** 送信せず実行記録に残す食い違い。 */
  anomalies: AnchorAnomaly[];
}

/**
 * 対象をチェーン上の状態と突き合わせ、送信・記録・食い違いに分ける。
 *
 * @param targets ハッシュを算出済みの対象と、そのチェーン上の状態
 * @returns 突き合わせの結果
 */
export function reconcile(
  targets: readonly (PreparedTarget & { chain: ChainState })[],
): Reconciliation {
  const result: Reconciliation = { toSend: [], alreadyAnchored: [], anomalies: [] };

  for (const { chain, ...target } of targets) {
    const anchored = chain.anchoredHash.toLowerCase();
    const computed = target.hash.toLowerCase();

    if (anchored !== ZERO_HASH && anchored === computed) {
      result.alreadyAnchored.push(target);
      continue;
    }

    if (anchored !== ZERO_HASH) {
      result.anomalies.push({
        date: target.date,
        revision: target.revision,
        computedHash: target.hash,
        anchoredHash: chain.anchoredHash,
        latestRevision: chain.latestRevision,
        reason: '刻印されたハッシュが保存物と一致しません',
      });
      continue;
    }

    if (chain.latestRevision > target.revision) {
      result.anomalies.push({
        date: target.date,
        revision: target.revision,
        computedHash: target.hash,
        anchoredHash: chain.anchoredHash,
        latestRevision: chain.latestRevision,
        reason: 'チェーン上の最大のリビジョンが保存物より大きい値です',
      });
      continue;
    }

    result.toSend.push(target);
  }

  return result;
}
