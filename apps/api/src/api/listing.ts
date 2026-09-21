import { latestRevisionByPrefix } from '../r2-listing.js';

/**
 * 取得可能な日付の一覧。
 *
 * 「最新リビジョンが刻印済み」を「取得可能」の定義とする。判定には `records/` と
 * `anchors/` の最新リビジョンの突き合わせが要る。刻印が 1 件でもあることをもって
 * 刻印済みと見なすと、訂正リビジョンが追加されてから刻印されるまでの間、その日を
 * 古い刻印済みのリビジョン番号で一覧に出してしまう。その日を取得すると最新が
 * 未刻印であるため拒まれ、一覧が示した番号とも食い違う。
 *
 * 金額を含めないのは、一覧だけで収支の概形が分かってしまうと、有料のレコードを
 * 取得する意味が薄れるためである。詳細は specs/paid-record-api/spec.md を参照。
 */

/** 一覧の 1 件。 */
export interface AvailableRecord {
  /** 対象日（YYYY-MM-DD 形式）。 */
  date: string;
  /** 刻印済みの最新リビジョン番号。レコードの最新リビジョンと一致する。 */
  revision: number;
}

/**
 * 取得可能な対象日を、新しい順に列挙する。
 *
 * @param bucket 取得元の R2 バケット
 * @returns 取得可能な対象日とリビジョン番号
 */
export async function listAvailableRecords(bucket: R2Bucket): Promise<AvailableRecord[]> {
  const [records, anchored] = await Promise.all([
    latestRevisionByPrefix(bucket, 'records/'),
    latestRevisionByPrefix(bucket, 'anchors/'),
  ]);

  return [...records.entries()]
    .filter(([date, revision]) => anchored.get(date) === revision)
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([date, revision]) => ({ date, revision }));
}
