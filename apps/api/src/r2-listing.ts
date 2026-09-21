/**
 * R2 の `{接頭辞}{対象日}/{リビジョン}.json` 形式のキーを列挙する共通処理。
 *
 * ④の刻印対象の算出（`anchors/` と `records/` の突き合わせ）と、⑤の取得可能な
 * 日付の一覧（`anchors/` のみ）の両方が、この形のキーから対象日ごとの最大リビジョンを
 * 求める必要があるため、ここに切り出す。
 */

/**
 * 接頭辞に一致するキーをすべて列挙する。
 *
 * R2 の 1 度の列挙には件数の上限があるため、`truncated` が立つ間は `cursor` で
 * 続きを辿る。辿らないと、保存物が増えたときに一部だけが返る。
 *
 * @param bucket 取得元の R2 バケット
 * @param prefix キーの接頭辞
 * @returns オブジェクトキーの配列
 */
export async function listKeys(bucket: R2Bucket, prefix: string): Promise<string[]> {
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
 * `{接頭辞}{対象日}/{リビジョン}.json` のキーから、対象日ごとの最大のリビジョンを求める。
 *
 * @param keys オブジェクトキーの配列
 * @param prefix 除去する接頭辞
 * @returns 対象日をキー、最大のリビジョン番号を値とする対応
 */
function latestRevisionFromKeys(keys: readonly string[], prefix: string): Map<string, number> {
  const latest = new Map<string, number>();

  for (const key of keys) {
    if (!key.startsWith(prefix)) {
      continue;
    }

    const [date, file] = key.slice(prefix.length).split('/');
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

/**
 * 接頭辞配下の全キーを列挙し、対象日ごとの最大のリビジョンを求める。
 *
 * @param bucket 取得元の R2 バケット
 * @param prefix キーの接頭辞（末尾の `/` を含む）
 * @returns 対象日をキー、最大のリビジョン番号を値とする対応
 */
export async function latestRevisionByPrefix(
  bucket: R2Bucket,
  prefix: string,
): Promise<Map<string, number>> {
  return latestRevisionFromKeys(await listKeys(bucket, prefix), prefix);
}
