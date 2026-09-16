/**
 * 刻印と検証で用いるハッシュの算出。
 *
 * レコードのバイト列そのものを対象とし、解析して直列化し直した結果は用いない。
 * SHA-256 は `sha256sum` や Web Crypto など一般的な道具で算出でき、検証者に
 * EVM 固有の道具を求めない。詳細は specs/anchor-verification/spec.md を参照。
 */

/** チェーン上の表記に合わせた 16 進文字列（`0x` で始まる）。 */
export type HexHash = `0x${string}`;

/**
 * バイト列の SHA-256 を求める。
 *
 * 戻り値はチェーン上の `bytes32` と同じ表記にする。`sha256sum` の出力は `0x` を
 * 伴わないため、比較するときは接頭辞の有無を揃える。
 *
 * @param bytes 対象のバイト列
 * @returns `0x` で始まる小文字の 16 進文字列
 */
export async function sha256Hex(bytes: Uint8Array): Promise<HexHash> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);

  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

  return `0x${hex}`;
}
