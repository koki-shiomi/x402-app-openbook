import { canonicalize } from '@openbook/shared';

/** 収集ソース 1 件の実行結果。 */
export interface SourceResult {
  /** 取得元の識別子。 */
  id: string;
  /** 取得に成功したか。 */
  ok: boolean;
  /** 失敗した場合の理由。 */
  reason?: string;
}

/** 閾値以下のため訂正リビジョンを見送った集計値の変化 1 件。 */
export interface DeferredChange {
  /** 対象の集計値。 */
  field: 'revenueJpy' | 'costJpy';
  /** 既存の最新リビジョンの値。 */
  existing: string;
  /** 今回生成した値。 */
  next: string;
  /** 差（今回の値 - 既存の値）。 */
  difference: string;
}

/** 閾値以下のため訂正リビジョンを追加しなかった判断。 */
export interface DeferredRevision {
  /** 集計値ごとの変化。 */
  changes: DeferredChange[];
  /** 判定に用いた閾値。 */
  threshold: {
    /** 差の絶対値の上限（JPY）。 */
    maxDifference: string;
    /** 既存の値に対する差の比率の上限。 */
    maxRatio: string;
  };
}

/** 日次実行 1 回分の記録。 */
export interface RunLog {
  /** 対象日（YYYY-MM-DD 形式）。 */
  date: string;
  /** 実行開始時刻（RFC 3339）。 */
  startedAt: string;
  /** 実行終了時刻（RFC 3339）。 */
  finishedAt: string;
  /** 全体として成功したか。全ソース失敗の場合は false。 */
  ok: boolean;
  /** 収集ソースごとの成否。 */
  sources: SourceResult[];
  /** 生成したレコードのリビジョン番号。生成しなかった場合は持たない。 */
  revision?: number;
  /** 遡及可能期間外のため呼び出さなかった収集ソースの識別子。 */
  skippedSources?: string[];
  /** 閾値以下のため訂正リビジョンを追加しなかった判断。見送らなかった場合は持たない。 */
  deferred?: DeferredRevision;
}

/**
 * 実行記録のキーを対象日から導出する。
 *
 * @param date 対象日（YYYY-MM-DD 形式）
 * @returns R2 のオブジェクトキー
 */
export function runKey(date: string): string {
  return `runs/${date}.json`;
}

/**
 * 実行記録を保存する。
 *
 * 同じ日を複数回実行しうるため、実行記録は上書きする。レコード本体の不変性とは別扱い。
 *
 * @param bucket 保存先の R2 バケット
 * @param log 保存する実行記録
 */
export async function writeRun(bucket: R2Bucket, log: RunLog): Promise<void> {
  await bucket.put(runKey(log.date), canonicalize(log));
}

/**
 * 実行記録を読み出す。
 *
 * @param bucket 取得元の R2 バケット
 * @param date 対象日（YYYY-MM-DD 形式）
 * @returns 実行記録。存在しない場合は null
 */
export async function readRun(bucket: R2Bucket, date: string): Promise<RunLog | null> {
  const object = await bucket.get(runKey(date));
  return object === null ? null : ((await object.json()) as RunLog);
}
