import type { DailyRecord } from '@openbook/shared';

import { runDaily, type CollectionSource, type RunOptions } from './batch.js';
import { closeMonth, closeKey, getRecord, type CloseRecord } from './storage.js';

/**
 * 定期実行のスケジュールと、対象期間の算出。
 *
 * 日次実行は前日を対象とし、当月内の各日を再収集する。翌月の所定日に月次クローズを
 * 行い、その月への書き込みを締め切る。詳細は specs/daily-batch/spec.md を参照。
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
 * 指定月の全日を列挙する。
 *
 * @param month 対象月（YYYY-MM 形式）
 * @returns 月内の全日（YYYY-MM-DD 形式）を昇順で
 */
export function datesInMonth(month: string): string[] {
  const [year, monthNumber] = month.split('-').map(Number) as [number, number];
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();

  return Array.from(
    { length: lastDay },
    (_unused, index) => `${month}-${String(index + 1).padStart(2, '0')}`,
  );
}

/**
 * 実行時刻が属する月の前月を求める。
 *
 * @param now 実行時刻（RFC 3339）
 * @returns 前月（YYYY-MM 形式）
 */
export function previousMonth(now: string): string {
  const date = new Date(now);
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - 1);

  return date.toISOString().slice(0, 7);
}

/**
 * 月次クローズの記録を読み出す。
 *
 * @param bucket 取得元の R2 バケット
 * @param month 対象月（YYYY-MM 形式）
 * @returns クローズ記録。存在しない場合は null
 */
export async function readClose(
  bucket: R2Bucket,
  month: string,
): Promise<CloseRecord | null> {
  const object = await bucket.get(closeKey(month));
  return object === null ? null : ((await object.json()) as CloseRecord);
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
 * 当月内のうち、既にレコードがある日を再収集する。
 *
 * 広告収益は約 4 時間遅れて反映され、出現から最初の 48 時間は頻繁に変動する。
 * 前日分を 1 回取得しただけでは、その後の変動が反映されない。
 *
 * @param bucket 保存先の R2 バケット
 * @param sources 実行する収集ソース
 * @param options 実行の依存
 * @returns 訂正リビジョンが追加された日の一覧
 */
export async function recollectCurrentMonth(
  bucket: R2Bucket,
  sources: readonly CollectionSource[],
  options: RunOptions,
): Promise<string[]> {
  const month = options.now.slice(0, 7);
  const today = options.now.slice(0, 10);
  const updated: string[] = [];

  for (const date of datesInMonth(month)) {
    if (date >= today) {
      continue;
    }

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

/**
 * 月次クローズを実行する。
 *
 * 対象月のうち既存のレコードがある日を再収集して最終リビジョンを確定させ、
 * クローズ済みとして記録する。以降その月への書き込みは拒否され、この月が
 * ハッシュ刻印の対象となる。
 *
 * レコードがない日は収集しない。レコードがない日には収集を開始する前の日が含まれ、
 * 作成すると稼働開始前の日を遡って取り込むことになる。
 *
 * 取得元の遡及可能期間を超えている日は再収集せず、既存の最新リビジョンを維持する。
 * 再収集を試みなかった取得元と対象日はクローズ記録に残す。
 *
 * @param bucket 保存先の R2 バケット
 * @param sources 実行する収集ソース
 * @param month 対象月（YYYY-MM 形式）
 * @param options 実行の依存
 * @returns 保存したクローズ記録
 */
export async function runMonthlyClose(
  bucket: R2Bucket,
  sources: readonly CollectionSource[],
  month: string,
  options: RunOptions,
): Promise<CloseRecord> {
  const finalRevisions: Record<string, number> = {};
  const skippedBySource = new Map<string, string[]>();

  for (const date of datesInMonth(month)) {
    if ((await readRevision(bucket, date)) === null) {
      continue;
    }

    const { skipped } = await collectWithinReach(bucket, sources, date, options);
    for (const id of skipped) {
      skippedBySource.set(id, [...(skippedBySource.get(id) ?? []), date]);
    }

    const revision = await readRevision(bucket, date);
    if (revision !== null) {
      finalRevisions[date] = revision;
    }
  }

  const skipped = [...skippedBySource.entries()].map(([source, dates]) => ({
    source,
    dates,
  }));

  return closeMonth(bucket, month, {
    closedAt: options.now,
    finalRevisions,
    ...(skipped.length === 0 ? {} : { skipped }),
  });
}
