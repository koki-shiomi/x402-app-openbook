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

/** 収集の定期実行 1 回分の記録。 */
export interface CollectionRunLog {
  /** 実行開始時刻（RFC 3339）。 */
  startedAt: string;
  /** 実行終了時刻（RFC 3339）。 */
  finishedAt: string;
  /** 起動した定期実行の指定。 */
  trigger: string;
  /** 再収集した対象日。 */
  dates: string[];
  /** 訂正リビジョンが追加された対象日。 */
  updated: string[];
  /** 使用した問い合わせ回数。 */
  requestsUsed: number;
  /** 1 回の実行で使える問い合わせ回数の予算。 */
  requestBudget: number;
  /** 予算が足りず処理しなかった最初の対象日。打ち切りがなければ持たない。 */
  stoppedAt?: string;
  /** 資源制約により収集を行えなかった対象日とその理由。 */
  interrupted?: { date: string; reason: string }[];
  /** 収集を行わなかった場合の理由。行った場合は持たない。 */
  reason?: string;
}

/**
 * 収集の定期実行の記録のキーを実行開始時刻と定期実行の指定から導出する。
 *
 * 1 日に複数の定期実行が動くため、時刻だけでは同じ日の記録が互いを上書きしうる。
 * 指定も含めることで、定期実行ごとに 1 件の記録が残る。
 *
 * @param startedAt 実行開始時刻（RFC 3339）
 * @param trigger 起動した定期実行の指定
 * @returns R2 のオブジェクトキー
 */
export function collectionRunKey(startedAt: string, trigger: string): string {
  const time = startedAt.replaceAll(':', '-').replace('.', '-');
  const slug = trigger.replaceAll(/[^0-9A-Za-z]+/g, '-').replace(/^-|-$/g, '');

  return `collection-runs/${time}_${slug}.json`;
}

/**
 * 収集の定期実行の記録を保存する。
 *
 * 対象日ごとの記録（`runs/`）とは別に、1 回の実行が何を扱い、予算をどれだけ
 * 使ったかを残す。担当範囲の網羅と打ち切りの有無は、実行単位でしか分からない。
 *
 * @param bucket 保存先の R2 バケット
 * @param log 保存する実行記録
 */
export async function writeCollectionRun(
  bucket: R2Bucket,
  log: CollectionRunLog,
): Promise<void> {
  await bucket.put(collectionRunKey(log.startedAt, log.trigger), canonicalize(log));
}

/**
 * 収集の定期実行の記録を古い順に読み出す。
 *
 * @param bucket 取得元の R2 バケット
 * @returns 実行記録の配列
 */
export async function readCollectionRuns(bucket: R2Bucket): Promise<CollectionRunLog[]> {
  const listed = await bucket.list({ prefix: 'collection-runs/' });
  const keys = listed.objects.map((object) => object.key).sort();

  const runs: CollectionRunLog[] = [];
  for (const key of keys) {
    const object = await bucket.get(key);
    if (object !== null) {
      runs.push((await object.json()) as CollectionRunLog);
    }
  }

  return runs;
}
