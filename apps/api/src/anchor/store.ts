import { canonicalize } from '@openbook/shared';

/**
 * 刻印の結果と実行記録の保存。
 *
 * 結果はリビジョンごとに 1 件の不変なオブジェクトとし、実行記録は刻印のたびに
 * 別のキーへ残す。詳細は specs/hash-anchoring/spec.md を参照。
 */

/** 刻印が成立した 1 リビジョンの記録。 */
export interface AnchorRecord {
  /** 対象日（YYYY-MM-DD 形式）。 */
  date: string;
  /** リビジョン番号。 */
  revision: number;
  /** 刻印したハッシュ。 */
  hash: string;
  /** 刻印したチェーンの ID。 */
  chainId: number;
  /** 刻印のコントラクトのアドレス。 */
  contractAddress: string;
  /** 刻印のトランザクションのハッシュ。送信前の突き合わせで刻印済みと判定した場合は持たない。 */
  transactionHash?: string;
  /** 刻印が含まれるブロック番号。同上。 */
  blockNumber?: number;
  /** この記録を保存した時刻（RFC 3339）。 */
  recordedAt: string;
}

/**
 * 刻印の結果のキーを対象日とリビジョンから導出する。
 *
 * @param date 対象日（YYYY-MM-DD 形式）
 * @param revision リビジョン番号（1 始まり）
 * @returns R2 のオブジェクトキー
 */
export function anchorKey(date: string, revision: number): string {
  return `anchors/${date}/${String(revision).padStart(3, '0')}.json`;
}

/**
 * 刻印の実行記録のキーを実行時刻から導出する。
 *
 * 刻印は対象日をまたいで 1 件にまとめるため、対象日ごとの実行記録には収まらない。
 * 同じ日に複数回実行しても上書きしないよう、時刻をキーに含める。
 *
 * @param startedAt 実行開始時刻（RFC 3339）
 * @returns R2 のオブジェクトキー
 */
export function anchorRunKey(startedAt: string): string {
  return `anchor-runs/${startedAt.replaceAll(':', '-').replace('.', '-')}.json`;
}

/**
 * 刻印の結果を保存する。既に同じキーがある場合は上書きしない。
 *
 * @param bucket 保存先の R2 バケット
 * @param record 保存する結果
 */
export async function putAnchorRecord(bucket: R2Bucket, record: AnchorRecord): Promise<void> {
  const key = anchorKey(record.date, record.revision);
  if ((await bucket.head(key)) !== null) {
    return;
  }

  await bucket.put(key, canonicalize(record), { onlyIf: { etagDoesNotMatch: '*' } });
}

/** 刻印 1 回分の実行記録。 */
export interface AnchorRunLog {
  /** 実行開始時刻（RFC 3339）。 */
  startedAt: string;
  /** 実行終了時刻（RFC 3339）。 */
  finishedAt: string;
  /** 刻印が意図どおり完了したか。 */
  ok: boolean;
  /** 刻印の対象としたリビジョン。 */
  targets: { date: string; revision: number }[];
  /** 今回の実行で刻印が成立したリビジョン。 */
  anchored: { date: string; revision: number }[];
  /** 上限により次の実行へ回したリビジョン。 */
  deferred: { date: string; revision: number }[];
  /** 接続先のチェーン ID。設定が欠けている場合は持たない。 */
  chainId?: number;
  /** 刻印のコントラクトのアドレス。 */
  contractAddress?: string;
  /** 送信したトランザクションのハッシュ。送信しなかった場合は持たない。 */
  transactionHash?: string;
  /** 取り込まれたブロック番号。 */
  blockNumber?: number;
  /** 保存物とチェーン上の刻印の食い違い。 */
  anomalies?: unknown[];
  /** 刻印を行わなかった、または失敗した理由。 */
  reason?: string;
  /** 未設定のシークレットの名前。 */
  missingSecrets?: string[];
}

/**
 * 刻印の実行記録を保存する。実行ごとに別のキーへ残し、上書きしない。
 *
 * @param bucket 保存先の R2 バケット
 * @param log 保存する実行記録
 */
export async function writeAnchorRun(bucket: R2Bucket, log: AnchorRunLog): Promise<void> {
  await bucket.put(anchorRunKey(log.startedAt), canonicalize(log));
}

/**
 * 刻印の実行記録を古い順に読み出す。
 *
 * @param bucket 取得元の R2 バケット
 * @returns 実行記録の配列
 */
export async function readAnchorRuns(bucket: R2Bucket): Promise<AnchorRunLog[]> {
  const listed = await bucket.list({ prefix: 'anchor-runs/' });
  const keys = listed.objects.map((object) => object.key).sort();

  const runs: AnchorRunLog[] = [];
  for (const key of keys) {
    const object = await bucket.get(key);
    if (object !== null) {
      runs.push((await object.json()) as AnchorRunLog);
    }
  }

  return runs;
}

/**
 * 刻印の結果を読み出す。
 *
 * @param bucket 取得元の R2 バケット
 * @param date 対象日（YYYY-MM-DD 形式）
 * @param revision リビジョン番号
 * @returns 刻印の結果。存在しない場合は null
 */
export async function readAnchorRecord(
  bucket: R2Bucket,
  date: string,
  revision: number,
): Promise<AnchorRecord | null> {
  const object = await bucket.get(anchorKey(date, revision));
  return object === null ? null : ((await object.json()) as AnchorRecord);
}
