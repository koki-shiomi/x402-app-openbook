/**
 * 日次財務レコードの正準 JSON 表現。
 *
 * ここで生成したバイト列が、そのまま R2 への保存物・ハッシュ刻印の対象・
 * 有料 API のレスポンス本文になる。同一内容から常に同一のバイト列が得られることを
 * 保証する必要がある。詳細は specs/financial-record/spec.md の「正準JSON表現」を参照。
 *
 * 直列化は RFC 8785（JSON Canonicalization Scheme）に従う。JCS は配列要素の順序を
 * 入力のまま保持するため、内容から一意に定まる並び順を別途規定する。
 */

/** 並び順を規定する配列と、その整列キーの取り出し方。 */
const ARRAY_SORT_KEYS: Record<string, (item: Record<string, unknown>) => string> = {
  costs: (item) => `${String(item['source'])} ${String(item['category'])}`,
  revenues: (item) => `${String(item['source'])} ${String(item['category'])}`,
  incomplete: (item) => `${String(item['kind'])} ${String(item['id'])}`,
  exchangeRates: (item) => String(item['pair']),
};

/**
 * 値を正準形の JSON 文字列へ直列化する。
 *
 * @param value 直列化する値
 * @param arrayKey この値が配列要素として属する項目名。並び順の判定に用いる
 * @returns JSON 文字列
 * @throws {TypeError} 有限でない数値や直列化できない型が含まれる場合
 */
function serialize(value: unknown, arrayKey?: string): string {
  if (value === null) {
    return 'null';
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`有限でない数値は直列化できません: ${value}`);
    }
    return String(value);
  }

  if (typeof value === 'string') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    const sortKey = arrayKey === undefined ? undefined : ARRAY_SORT_KEYS[arrayKey];
    const items =
      sortKey === undefined
        ? value
        : [...value].sort((a, b) =>
            sortKey(a as Record<string, unknown>).localeCompare(
              sortKey(b as Record<string, unknown>),
            ),
          );

    return `[${items.map((item) => serialize(item)).join(',')}]`;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

    const body = entries
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${serialize(entryValue, key)}`)
      .join(',');

    return `{${body}}`;
  }

  throw new TypeError(`直列化できない値です: ${typeof value}`);
}

/**
 * 値を正準 JSON のバイト列へ変換する。
 *
 * @param value 変換する値
 * @returns UTF-8 でエンコードした正準 JSON のバイト列
 */
export function canonicalize(value: unknown): Uint8Array {
  return new TextEncoder().encode(serialize(value));
}
