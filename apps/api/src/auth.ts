/**
 * 手動再実行エンドポイントの認証。
 *
 * design.md の決定 7 に従い、Workers の Secret に保管したトークンとの
 * 定数時間比較で判定する。通常の文字列比較は最初に異なる文字で打ち切られるため、
 * 応答時間から先頭何文字が一致したかを推測できる余地が残る。
 */

/**
 * 2 つの文字列を、長さと内容の差異にかかわらず一定時間で比較する。
 *
 * 長さが異なる場合も早期に返さず、比較そのものは常に同じ回数だけ行う。
 *
 * @param a 比較する文字列
 * @param b 比較する文字列
 * @returns 完全に一致する場合のみ true
 */
export function equalsInConstantTime(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);

  // 長さの違いを差分に畳み込み、比較回数を入力に依存させない。
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    diff |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }

  return diff === 0;
}

/**
 * Authorization ヘッダのトークンが期待値と一致するかを判定する。
 *
 * @param header Authorization ヘッダの値
 * @param expected 期待するトークン
 * @returns 認証が通る場合のみ true
 */
export function isAuthorized(
  header: string | undefined,
  expected: string | undefined,
): boolean {
  if (expected === undefined || expected === '' || header === undefined) {
    return false;
  }

  const prefix = 'Bearer ';
  if (!header.startsWith(prefix)) {
    return false;
  }

  return equalsInConstantTime(header.slice(prefix.length), expected);
}
