import { RECOLLECTION_DAYS, type DailyRecord } from '@openbook/shared';

import { runDaily, type CollectionSource, type RunOptions } from './batch.js';
import { isResourceLimitError, RequestBudget } from './budget.js';
import { writeCollectionRun } from './runlog.js';
import { getRecord } from './storage.js';

/**
 * 定期実行のスケジュールと、対象期間の算出。
 *
 * 日次実行は前日を対象とし、あわせて実行時点から一定日数以内の既存レコードを
 * 再収集する。書き込みの締切は設けない。詳細は specs/daily-batch/spec.md を参照。
 */

/**
 * 実行時刻から見た前日を UTC の暦日で求める。
 *
 * @param now 実行時刻（RFC 3339）
 * @returns 前日（YYYY-MM-DD 形式）
 */
export function previousDay(now: string): string {
  const date = new Date(now);
  date.setUTCDate(date.getUTCDate() - 1);

  return date.toISOString().slice(0, 10);
}

/**
 * 収集ソースのうち、対象日を遡って取得できるものだけを選ぶ。
 *
 * @param sources 収集ソース
 * @param date 対象日
 * @param now 実行時刻
 * @returns 取得可能なソースと、遡及制限で除外したソースの識別子
 */
function partitionByReach(
  sources: readonly CollectionSource[],
  date: string,
  now: string,
): { usable: CollectionSource[]; skipped: string[] } {
  const usable: CollectionSource[] = [];
  const skipped: string[] = [];

  for (const source of sources) {
    if (source.canCollect === undefined || source.canCollect(date, now)) {
      usable.push(source);
    } else {
      skipped.push(source.id);
    }
  }

  return { usable, skipped };
}

/**
 * 遡及できる収集ソースだけで対象日を収集し、遡及できないソースは既存の値を引き継ぐ。
 *
 * 遡及できないソースを単に除外して収集すると、そのソースの既存のエントリが
 * 新しいリビジョンから抜け落ち、欠測としても記録されないまま公開値から消える。
 * 遡及できるソースが 1 件もない日は収集せず、既存の最新リビジョンをそのまま維持する。
 *
 * @param bucket 保存先の R2 バケット
 * @param sources 登録されている収集ソース
 * @param date 対象日（YYYY-MM-DD 形式）
 * @param options 実行の依存
 * @returns 保存または維持したレコードと、遡及制限で除外したソースの識別子
 */
export async function collectWithinReach(
  bucket: R2Bucket,
  sources: readonly CollectionSource[],
  date: string,
  options: RunOptions,
): Promise<{ record: DailyRecord | null; skipped: string[] }> {
  const { usable, skipped } = partitionByReach(sources, date, options.now);
  if (usable.length === 0) {
    return { record: null, skipped };
  }

  const record = await runDaily(bucket, usable, date, options, skipped);
  return { record, skipped };
}

/** 実行日から何日前かで表した対象日の区間。両端を含む。 */
export interface OffsetRange {
  /** 近い側の日数（実行日から何日前か）。 */
  from: number;
  /** 遠い側の日数（実行日から何日前か）。 */
  to: number;
}

/**
 * 再収集の対象期間全体。
 *
 * 前日（1 日前）を含めないのは、前日は最初の定期実行が 1 回収集するためである。
 * 再収集にも含めると、同じ日を 1 回の実行で 2 度収集することになる。
 */
export const RECOLLECTION_RANGE: OffsetRange = { from: 2, to: RECOLLECTION_DAYS };

/**
 * 再収集の対象日を列挙する。
 *
 * 実行日当日は含めない。1 日が終わっていないため、収集しても対象日全体の値にならない。
 *
 * @param now 実行時刻（RFC 3339）
 * @param range 担当する対象日の区間。省略時は対象期間全体
 * @returns 対象日（YYYY-MM-DD 形式）を昇順で
 */
export function recollectionDates(
  now: string,
  range: OffsetRange = RECOLLECTION_RANGE,
): string[] {
  const dates: string[] = [];

  for (let offset = range.to; offset >= range.from; offset -= 1) {
    const date = new Date(`${now.slice(0, 10)}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - offset);
    dates.push(date.toISOString().slice(0, 10));
  }

  return dates;
}

/** 再収集の依存。 */
export interface RecollectionOptions extends RunOptions {
  /** 1 回の実行で使える問い合わせ回数の予算。省略時は数えない。 */
  budget?: RequestBudget;
  /** 担当する対象日の範囲。省略時は対象期間全体。 */
  slice?: OffsetRange;
}

/** 収集の定期実行 1 本の担当。 */
export interface CollectionDuty {
  /** 起動した定期実行の指定。実行記録に残す。 */
  cron: string;
  /** 前日の収集を担当するか。 */
  collectPreviousDay: boolean;
  /** 担当する再収集の対象日の範囲。 */
  slice: OffsetRange;
}

/** 再収集 1 回分の結果。 */
export interface RecollectionOutcome {
  /** 訂正リビジョンが追加された対象日。 */
  updated: string[];
  /** 再収集した対象日。 */
  processed: string[];
  /** 予算が足りず処理しなかった最初の対象日。打ち切りがなければ持たない。 */
  stoppedAt?: string;
  /** 資源制約により収集を行えなかった対象日とその理由。 */
  interrupted: { date: string; reason: string }[];
}

/**
 * 対象日 1 日の収集に必要な問い合わせ回数を見積もる。
 *
 * 遡及できる収集ソースの宣言を合計する。為替レートは、既存のレコードに
 * 記録がなく取得し直す場合のみ 1 件を加える。
 *
 * @param sources 登録されている収集ソース
 * @param date 対象日
 * @param now 実行時刻
 * @param options 見積もりの前提
 * @param options.fetchesRate 為替レートを取得し直すか。既定は取得する
 * @returns 見積もりの問い合わせ回数
 */
export function estimateRequests(
  sources: readonly CollectionSource[],
  date: string,
  now: string,
  options: { fetchesRate?: boolean } = {},
): number {
  const { usable } = partitionByReach(sources, date, now);
  if (usable.length === 0) {
    return 0;
  }

  const sources_ = usable.reduce((total, source) => total + source.requestsPerCollection, 0);
  return sources_ + (options.fetchesRate === false ? 0 : 1);
}

/**
 * 対象期間内のうち、既にレコードがある日を再収集する。
 *
 * 広告収益は約 4 時間遅れて反映され、出現から最初の 48 時間は頻繁に変動する。
 * さらに提供元は月末に無効なクリックとインプレッションの調整を行い、過去日の値を
 * 遡って変える。前日分を 1 回取得しただけでは、これらの変動が反映されない。
 *
 * レコードがない日は収集しない。レコードがない日には収集を開始する前の日が含まれ、
 * 作成すると稼働開始前の日を遡って取り込むことになる。
 *
 * 予算が渡された場合、次の対象日を処理する余地がなくなった時点で打ち切る。
 * 上限に達してから失敗すると、提供元の欠測と区別がつかない形で公開データに残る。
 *
 * @param bucket 保存先の R2 バケット
 * @param sources 実行する収集ソース
 * @param options 実行の依存
 * @returns 再収集の結果
 */
export async function recollectRecent(
  bucket: R2Bucket,
  sources: readonly CollectionSource[],
  options: RecollectionOptions,
): Promise<RecollectionOutcome> {
  const outcome: RecollectionOutcome = { updated: [], processed: [], interrupted: [] };

  for (const date of recollectionDates(options.now, options.slice)) {
    const existing = await readLatest(bucket, date);
    if (existing === null) {
      continue;
    }

    // レートが記録済みの日は取得し直さないため、その分を見積もりから除く。
    const needed = estimateRequests(sources, date, options.now, {
      fetchesRate: existing.exchangeRates.length === 0,
    });
    if (options.budget !== undefined && !options.budget.canAfford(needed)) {
      outcome.stoppedAt = date;
      break;
    }

    try {
      const { record: after } = await collectWithinReach(bucket, sources, date, options);
      outcome.processed.push(date);

      if (after !== null && after.revision !== existing.revision) {
        outcome.updated.push(date);
      }
    } catch (error) {
      if (!isResourceLimitError(error)) {
        throw error;
      }

      // 資源制約による中断は提供元の欠測ではない。レコードを変えずに次の実行へ委ねる。
      outcome.interrupted.push({
        date,
        reason: error instanceof Error ? error.message : String(error),
      });
      outcome.stoppedAt = date;
      break;
    }
  }

  return outcome;
}

/**
 * 1 本の定期実行が担当する収集を行い、実行記録を残す。
 *
 * 前日の収集を担当する場合は先に行う。前日が資源制約で中断しても、担当範囲の
 * 再収集は試みる。どちらも中断の扱いは同じで、レコードを変えずに次の実行へ委ねる。
 *
 * @param bucket 保存先の R2 バケット
 * @param sources 実行する収集ソース
 * @param options 実行の依存
 * @param duty この定期実行の担当
 * @returns 収集の結果
 */
export async function runCollection(
  bucket: R2Bucket,
  sources: readonly CollectionSource[],
  options: RecollectionOptions,
  duty: CollectionDuty,
): Promise<RecollectionOutcome> {
  const startedAt = options.now;
  const interrupted: { date: string; reason: string }[] = [];

  if (duty.collectPreviousDay) {
    const date = previousDay(options.now);
    try {
      await collectWithinReach(bucket, sources, date, options);
    } catch (error) {
      if (!isResourceLimitError(error)) {
        throw error;
      }
      interrupted.push({
        date,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const outcome = await recollectRecent(bucket, sources, {
    ...options,
    slice: duty.slice,
  });
  outcome.interrupted = [...interrupted, ...outcome.interrupted];

  await writeCollectionRun(bucket, {
    startedAt,
    finishedAt: options.now,
    trigger: duty.cron,
    dates: outcome.processed,
    updated: outcome.updated,
    requestsUsed: options.budget?.used ?? 0,
    requestBudget: options.budget?.limit ?? 0,
    ...(outcome.stoppedAt === undefined ? {} : { stoppedAt: outcome.stoppedAt }),
    ...(outcome.interrupted.length === 0 ? {} : { interrupted: outcome.interrupted }),
  });

  return outcome;
}

/**
 * 指定日の最新リビジョンのレコードを読み出す。
 *
 * @param bucket 取得元の R2 バケット
 * @param date 対象日
 * @returns 最新リビジョンのレコード。存在しない場合は null
 */
async function readLatest(bucket: R2Bucket, date: string): Promise<DailyRecord | null> {
  const bytes = await getRecord(bucket, date);
  if (bytes === null) {
    return null;
  }

  return JSON.parse(new TextDecoder().decode(bytes)) as DailyRecord;
}
