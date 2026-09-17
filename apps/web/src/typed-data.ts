/**
 * ウォレットへ渡す EIP-712 の内容の組み立て。
 *
 * `eth_signTypedData_v4` は、`types` に `EIP712Domain` があることを前提に
 * ドメインを符号化する。省くとウォレットは別のドメインで署名し、コントラクトが
 * 署名を拒む。署名そのものは返るため、送信して初めて失敗が分かる。
 *
 * 2026-09-17 に実際のウォレットで `FiatTokenV2: invalid signature` として現れた。
 * 署名から署名者を復元すると別のアドレスになり、想定と異なる内容に署名されて
 * いたことを確認している。
 */

/** ドメインの項目名と EIP-712 の型の対応。 */
const DOMAIN_FIELD_TYPES: Record<string, string> = {
  name: 'string',
  version: 'string',
  chainId: 'uint256',
  verifyingContract: 'address',
  salt: 'bytes32',
};

/**
 * `eth_signTypedData_v4` へ渡す JSON を組み立てる。
 *
 * ドメインが実際に持つ項目から `EIP712Domain` の定義を作る。定義と内容がずれると
 * ウォレットの符号化も変わるため、固定の定義を書かずに内容から導く。
 *
 * @param domain EIP-712 のドメイン
 * @param types 署名する型の定義（`EIP712Domain` を含めない）
 * @param primaryType 署名する型の名前
 * @param message 署名する内容
 * @returns ウォレットへ渡す JSON の文字列
 */
export function toSignTypedDataPayload(
  domain: Record<string, unknown>,
  types: Record<string, readonly { name: string; type: string }[]>,
  primaryType: string,
  message: Readonly<Record<string, unknown>>,
): string {
  const domainType = Object.keys(domain).map((name) => {
    const type = DOMAIN_FIELD_TYPES[name];
    if (type === undefined) {
      throw new Error(`扱わないドメインの項目です: ${name}`);
    }

    return { name, type };
  });

  return JSON.stringify({
    domain,
    types: { EIP712Domain: domainType, ...types },
    primaryType,
    message,
  });
}
