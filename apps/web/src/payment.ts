import type { PaymentTerms } from './api.js';
import type { EthereumProvider } from './preconditions.js';

/**
 * 支払いの署名の組み立て。
 *
 * 決済の取次は、自身が `/supported` で広告した EIP-712 のドメインでの署名しか
 * 受理しない。そのドメインは API が支払いの条件の `extra` として返すため、
 * 画面に固定で持たず、条件から取り出して用いる。固定で持つと取次側の変更に
 * 追従できない。詳細は design.md の決定 3 を参照。
 */

/** `TransferWithAuthorization` の型の定義。 */
const TRANSFER_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

/** 署名する支払いの内容。数値は EIP-1193 で渡すため文字列で持つ。 */
export interface Authorization {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}

/** 署名する内容一式。 */
export interface BuiltAuthorization {
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: `0x${string}`;
  };
  types: typeof TRANSFER_TYPES;
  authorization: Authorization;
}

/**
 * 支払いの条件から、署名する内容を組み立てる。
 *
 * @param terms API が提示した支払いの条件
 * @param from 支払い元のアドレス
 * @param now 現在時刻をミリ秒で返す関数。テストから差し替える
 * @returns 署名する内容
 */
export function buildAuthorization(
  terms: PaymentTerms,
  from: string,
  now: () => number = Date.now,
): BuiltAuthorization {
  const extra = terms.extra;
  const name = extra['name'];
  const version = extra['version'];
  const verifyingContract = extra['verifyingContract'];

  if (
    typeof name !== 'string' ||
    typeof version !== 'string' ||
    typeof verifyingContract !== 'string'
  ) {
    throw new Error('支払いの条件に EIP-712 のドメインが含まれていません');
  }

  const seconds = Math.floor(now() / 1000);

  return {
    domain: {
      name,
      version,
      chainId: chainIdOf(terms.network),
      verifyingContract: verifyingContract as `0x${string}`,
    },
    types: TRANSFER_TYPES,
    authorization: {
      from,
      to: terms.payTo,
      value: terms.amount,
      validAfter: '0',
      validBefore: String(seconds + terms.maxTimeoutSeconds),
      nonce: randomNonce(),
    },
  };
}

/**
 * 組み立てた内容にウォレットで署名する。
 *
 * 秘密鍵は画面が扱わず、署名はウォレットの中で行われる。
 *
 * @param ethereum ウォレットのプロバイダ
 * @param built 署名する内容
 * @returns 署名
 */
export async function signPayment(
  ethereum: EthereumProvider,
  built: BuiltAuthorization,
): Promise<string> {
  const payload = JSON.stringify({
    domain: built.domain,
    types: built.types,
    primaryType: 'TransferWithAuthorization',
    message: built.authorization,
  });

  return (await ethereum.request({
    method: 'eth_signTypedData_v4',
    params: [built.authorization.from, payload],
  })) as string;
}

/**
 * 支払いを添える要求のヘッダの値を作る。
 *
 * @param terms 提示された支払いの条件
 * @param resource 対象となる資源の情報
 * @param built 署名した内容
 * @param signature 署名
 * @returns `PAYMENT-SIGNATURE` へ載せる値
 */
export function toPaymentHeader(
  terms: PaymentTerms,
  resource: unknown,
  built: BuiltAuthorization,
  signature: string,
): string {
  return btoa(
    JSON.stringify({
      x402Version: 2,
      payload: { authorization: built.authorization, signature },
      resource,
      accepted: terms,
    }),
  );
}

/**
 * 使い捨ての nonce を作る。
 *
 * 同じ nonce の支払いは取次が二重として拒むため、要求ごとに変える。
 *
 * @returns 32 バイトの 16 進表記
 */
function randomNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));

  return `0x${[...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * CAIP-2 のネットワーク表記からチェーン ID を取り出す。
 *
 * @param network `eip155:5042002` の形の表記
 * @returns チェーン ID
 */
function chainIdOf(network: string): number {
  const parsed = Number.parseInt(network.split(':')[1] ?? '', 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`ネットワークの表記を解釈できません: ${network}`);
  }

  return parsed;
}
