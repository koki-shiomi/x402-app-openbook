/**
 * 刻印の対象の算出。
 *
 * 保存済みのレコードの一覧と刻印の結果の一覧を突き合わせ、最新リビジョンが未刻印の
 * 日を対象とする。再収集の対象期間には依存しない。刻印の失敗や、刻印の仕組みを
 * 導入する前に保存されたレコードを、期間に関わらず取りこぼさないためである。
 * 詳細は specs/hash-anchoring/spec.md を参照。
 */

/** 1 回の送信に含める刻印の上限。ブロックのガス上限に対して十分小さい値とする。 */
export const ANCHOR_BATCH_LIMIT = 30;

/** 刻印の対象 1 件。 */
export interface AnchorTarget {
  /** 対象日（YYYY-MM-DD 形式）。 */
  date: string;
  /** 刻印するリビジョン番号。 */
  revision: number;
}

/**
 * 接頭辞に一致するキーをすべて列挙する。
 *
 * @param bucket 取得元の R2 バケット
 * @param prefix キーの接頭辞
 * @returns オブジェクトキーの配列
 */
async function listKeys(bucket: R2Bucket, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;

  do {
    const listed = await bucket.list(cursor === undefined ? { prefix } : { prefix, cursor });
    keys.push(...listed.objects.map((object) => object.key));
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor !== undefined);

  return keys;
}

/**
 * `<接頭辞>/{対象日}/{リビジョン}.json` のキーから、対象日ごとの最大のリビジョンを求める。
 *
 * @param keys オブジェクトキーの配列
 * @returns 対象日をキー、最大のリビジョン番号を値とする対応
 */
function latestRevisionByDate(keys: readonly string[]): Map<string, number> {
  const latest = new Map<string, number>();

  for (const key of keys) {
    const [, date, file] = key.split('/');
    if (date === undefined || file === undefined) {
      continue;
    }

    const revision = Number(file.replace('.json', ''));
    if (!Number.isInteger(revision)) {
      continue;
    }

    latest.set(date, Math.max(latest.get(date) ?? 0, revision));
  }

  return latest;
}

/** 刻印の対象の一覧。 */
export interface AnchorTargets {
  /** 今回の送信に含める対象。対象日の新しい順。 */
  targets: AnchorTarget[];
  /** 上限を超えたため次の実行へ回した対象。 */
  deferred: AnchorTarget[];
}

/**
 * 最新リビジョンが未刻印の日を、対象日の新しい順に返す。
 *
 * 上限を超えた分は次の実行へ回す。新しい日を優先するのは、直近のデータを早く
 * 証明することを優先するためである。
 *
 * @param bucket 取得元の R2 バケット
 * @returns 刻印の対象と、次の実行へ回した対象
 */
export async function listAnchorTargets(bucket: R2Bucket): Promise<AnchorTargets> {
  const records = latestRevisionByDate(await listKeys(bucket, 'records/'));
  const anchored = latestRevisionByDate(await listKeys(bucket, 'anchors/'));

  const pending = [...records.entries()]
    .filter(([date, revision]) => (anchored.get(date) ?? 0) < revision)
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([date, revision]) => ({ date, revision }));

  return {
    targets: pending.slice(0, ANCHOR_BATCH_LIMIT),
    deferred: pending.slice(ANCHOR_BATCH_LIMIT),
  };
}
