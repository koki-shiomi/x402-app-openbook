import { latestRevisionByPrefix } from '../r2-listing.js';

/**
 * 取得可能な日付の一覧。
 *
 * 「刻印済み」を「取得可能」の定義とする。`anchors/` のキーがあるということは
 * 刻印済みであり、`records/` と突き合わせる必要がない。金額を含めないのは、
 * 一覧だけで収支の概形が分かってしまうと、有料のレコードを取得する意味が
 * 薄れるためである。詳細は specs/paid-record-api/spec.md を参照。
 */

/** 一覧の 1 件。 */
export interface AvailableRecord {
  /** 対象日（YYYY-MM-DD 形式）。 */
  date: string;
  /** 刻印済みの最新リビジョン番号。 */
  revision: number;
}

/**
 * 取得可能な対象日を、新しい順に列挙する。
 *
 * @param bucket 取得元の R2 バケット
 * @returns 取得可能な対象日とリビジョン番号
 */
export async function listAvailableRecords(bucket: R2Bucket): Promise<AvailableRecord[]> {
  const anchored = await latestRevisionByPrefix(bucket, 'anchors/');

  return [...anchored.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([date, revision]) => ({ date, revision }));
}
