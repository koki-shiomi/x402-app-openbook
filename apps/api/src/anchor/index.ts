import { sha256Hex } from '@openbook/shared';

import { getRecord } from '../storage.js';
import { createAnchorChain, EXPECTED_CHAIN_ID, type AnchorChain } from './chain.js';
import { loadAnchorConfig, type AnchorConfig, type AnchorConfigInput } from './config.js';
import { reconcile, type PreparedTarget } from './reconcile.js';
import {
  putAnchorRecord,
  writeAnchorRun,
  type AnchorRunLog,
} from './store.js';
import { listAnchorTargets, type AnchorTarget } from './targets.js';

/**
 * 刻印の実行。
 *
 * 収集を行った実行の後に 1 回呼ばれ、最新リビジョンが未刻印の日をまとめて刻印する。
 * 例外は外へ投げず、結果を実行記録に残して返す。刻印の失敗は収集の失敗にしない。
 * 詳細は specs/hash-anchoring/spec.md を参照。
 */

/** 刻印の実行の依存。 */
export interface AnchorOptions {
  /** 実行時刻として記録する値（RFC 3339）。 */
  now: string;
  /** チェーンへの接続を組み立てる。テストから差し替える。 */
  createChain?: (config: AnchorConfig) => AnchorChain;
}

/** 対象日とリビジョンだけを取り出す。実行記録にはハッシュを持たせない。 */
function toTarget({ date, revision }: AnchorTarget): AnchorTarget {
  return { date, revision };
}

/**
 * 対象のレコードを読み、保存されたバイト列からハッシュを算出する。
 *
 * レコードが読めない対象は刻印できないため除く。
 *
 * @param bucket 取得元の R2 バケット
 * @param targets 刻印の対象
 * @returns ハッシュを算出できた対象
 */
async function prepare(
  bucket: R2Bucket,
  targets: readonly AnchorTarget[],
): Promise<PreparedTarget[]> {
  const prepared: PreparedTarget[] = [];

  for (const target of targets) {
    const bytes = await getRecord(bucket, target.date, target.revision);
    if (bytes === null) {
      continue;
    }

    prepared.push({ ...target, hash: await sha256Hex(bytes) });
  }

  return prepared;
}

/**
 * 最新リビジョンが未刻印の日を刻印する。
 *
 * @param bucket 保存先の R2 バケット
 * @param env 刻印の設定を含むシークレット
 * @param options 実行の依存
 * @returns 刻印の実行記録
 */
export async function runAnchoring(
  bucket: R2Bucket,
  env: AnchorConfigInput,
  options: AnchorOptions,
): Promise<AnchorRunLog> {
  const startedAt = options.now;
  const base = { startedAt, finishedAt: options.now, targets: [], anchored: [], deferred: [] };

  /** 実行記録を保存して返す。 */
  const finish = async (log: AnchorRunLog): Promise<AnchorRunLog> => {
    await writeAnchorRun(bucket, log);
    return log;
  };

  const { config, missing } = loadAnchorConfig(env);
  if (config === undefined) {
    return finish({
      ...base,
      ok: false,
      reason: '刻印の設定が未完了のため実行しませんでした',
      missingSecrets: missing,
    });
  }

  const { targets, deferred } = await listAnchorTargets(bucket);
  const common = {
    ...base,
    targets: targets.map(toTarget),
    deferred: deferred.map(toTarget),
    contractAddress: config.contractAddress,
  };

  if (targets.length === 0) {
    return finish({ ...common, ok: true, chainId: EXPECTED_CHAIN_ID });
  }

  const chain = (options.createChain ?? createAnchorChain)(config);

  try {
    const chainId = await chain.chainId();
    if (chainId !== EXPECTED_CHAIN_ID) {
      return finish({
        ...common,
        ok: false,
        chainId,
        reason: `接続先のチェーン ID が ${EXPECTED_CHAIN_ID} ではありません: ${chainId}`,
      });
    }

    const prepared = await prepare(bucket, targets);
    const states = await chain.readStates(prepared);
    const { toSend, alreadyAnchored, anomalies } = reconcile(
      prepared.map((target, index) => ({ ...target, chain: states[index]! })),
    );

    // チェーン上に既にある刻印は、送信の成否に関わらず記録できる。
    for (const item of alreadyAnchored) {
      await putAnchorRecord(bucket, {
        date: item.date,
        revision: item.revision,
        hash: item.hash,
        chainId,
        contractAddress: config.contractAddress,
        recordedAt: options.now,
      });
    }

    const withAnomalies = anomalies.length === 0 ? {} : { anomalies };

    if (toSend.length === 0) {
      return finish({
        ...common,
        ok: true,
        chainId,
        anchored: alreadyAnchored.map(toTarget),
        ...withAnomalies,
      });
    }

    const { transactionHash, blockNumber } = await chain.anchor(toSend);

    for (const item of toSend) {
      await putAnchorRecord(bucket, {
        date: item.date,
        revision: item.revision,
        hash: item.hash,
        chainId,
        contractAddress: config.contractAddress,
        transactionHash,
        blockNumber,
        recordedAt: options.now,
      });
    }

    return finish({
      ...common,
      ok: true,
      chainId,
      anchored: [...toSend, ...alreadyAnchored].map(toTarget),
      transactionHash,
      blockNumber,
      ...withAnomalies,
    });
  } catch (error) {
    return finish({
      ...common,
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}
