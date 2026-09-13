import { RECOLLECTION_DAYS, type DailyRecord } from '@openbook/shared';

import { runDaily, type CollectionSource, type RunOptions } from './batch.js';
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

/**
 * 再収集の対象日を列挙する。
 *
 * 実行日当日は含めない。1 日が終わっていないため、収集しても対象日全体の値にならない。
 *
 * @param now 実行時刻（RFC 3339）
 * @param days 実行時点から遡る日数
 * @returns 対象日（YYYY-MM-DD 形式）を昇順で
 */
export function recollectionDates(
  now: string,
  days: number = RECOLLECTION_DAYS,
): string[] {
  const dates: string[] = [];

  for (let offset = days; offset >= 1; offset -= 1) {
    const date = new Date(`${now.slice(0, 10)}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - offset);
    dates.push(date.toISOString().slice(0, 10));
  }

  return dates;
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
 * @param bucket 保存先の R2 バケット
 * @param sources 実行する収集ソース
 * @param options 実行の依存
 * @returns 訂正リビジョンが追加された日の一覧
 */
export async function recollectRecent(
  bucket: R2Bucket,
  sources: readonly CollectionSource[],
  options: RunOptions,
): Promise<string[]> {
  const updated: string[] = [];

  for (const date of recollectionDates(options.now)) {
    const before = await readRevision(bucket, date);
    if (before === null) {
      continue;
    }

    const { record: after } = await collectWithinReach(bucket, sources, date, options);

    if (after !== null && after.revision !== before) {
      updated.push(date);
    }
  }

  return updated;
}

/**
 * 指定日の最新リビジョン番号を読み出す。
 *
 * @param bucket 取得元の R2 バケット
 * @param date 対象日
 * @returns リビジョン番号。レコードが存在しない場合は null
 */
async function readRevision(bucket: R2Bucket, date: string): Promise<number | null> {
  const bytes = await getRecord(bucket, date);
  if (bytes === null) {
    return null;
  }

  return (JSON.parse(new TextDecoder().decode(bytes)) as DailyRecord).revision;
}
