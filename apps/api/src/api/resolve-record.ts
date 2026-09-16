import { isCalendarDate, type DailyRecord } from '@openbook/shared';

import { readAnchorRecord } from '../anchor/store.js';
import { getRecord } from '../storage.js';

/**
 * レコード取得の前段判定。
 *
 * 支払いを求める前に、対象日の妥当性・レコードの存在・刻印の有無を確かめる。
 * 支払いを求めてから存在しないと返すと、利用者が取得できないものに支払うことになる。
 * 詳細は specs/paid-record-api/spec.md の「未刻印の日の扱い」「存在しない日の扱い」を参照。
 */

/** 前段判定の結果。 */
export type RecordAccess =
  /** 対象日の形式が不正、または実在しない暦日。 */
  | { kind: 'invalid' }
  /** レコードが存在しない。 */
  | { kind: 'not-found' }
  /** レコードはあるが最新リビジョンが未刻印。 */
  | { kind: 'unanchored'; date: string }
  /** 刻印済みで取得できる。 */
  | { kind: 'ready'; date: string; revision: number };

/**
 * 対象日のレコードが取得できる状態かを判定する。
 *
 * @param bucket 取得元の R2 バケット
 * @param date 対象日（YYYY-MM-DD 形式を期待するが、検証前の入力を受け付ける）
 * @returns 判定結果
 */
export async function resolveRecordAccess(bucket: R2Bucket, date: string): Promise<RecordAccess> {
  if (!isCalendarDate(date)) {
    return { kind: 'invalid' };
  }

  const bytes = await getRecord(bucket, date);
  if (bytes === null) {
    return { kind: 'not-found' };
  }

  const revision = (JSON.parse(new TextDecoder().decode(bytes)) as DailyRecord).revision;
  const anchored = await readAnchorRecord(bucket, date, revision);

  return anchored === null
    ? { kind: 'unanchored', date }
    : { kind: 'ready', date, revision };
}
