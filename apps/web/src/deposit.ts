import { createPublicClient, encodeFunctionData, http, parseSignature, type Address } from 'viem';
import { ARC_CHAIN } from '@openbook/shared';

import { GATEWAY_WALLET_ABI } from '@openbook/shared';

import { ARC_RPC_URL, GATEWAY_WALLET, PAYMENT_ASSET } from './config.js';
import type { EthereumProvider } from './preconditions.js';
import { toSignTypedDataPayload } from './typed-data.js';

/**
 * 決済の取次へ預け入れた残高の照会と、画面からの預け入れ。
 *
 * ウォレットが保有する残高ではなく、取次へ預け入れた分が決済に使える。預け入れ
 * には `depositWithAuthorization` を用い、事前に使用枠を与えるトランザクションを
 * 要さない形にする。利用者に求めるのは署名 1 回とトランザクションの承認 1 回まで。
 * 詳細は design.md の決定 9 を参照。
 */

/** 資産自身の EIP-712 ドメイン。預け入れの署名に用いる。 */
const ASSET_DOMAIN = { name: 'USDC', version: '2' } as const;

/** 預け入れの署名の有効期間（秒）。 */
const VALIDITY_SECONDS = 3600;

/** `ReceiveWithAuthorization` の型の定義。 */
const RECEIVE_TYPES = {
  ReceiveWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

/**
 * 預け入れた残高を読む。
 *
 * @param asset 決済に用いる資産のアドレス
 * @param account 支払い元のアドレス
 * @returns 資産の最小単位での残高
 */
export async function readDeposit(asset: string, account: string): Promise<bigint> {
  const client = createPublicClient({ chain: ARC_CHAIN, transport: http(ARC_RPC_URL) });

  return await client.readContract({
    address: GATEWAY_WALLET as Address,
    abi: GATEWAY_WALLET_ABI,
    functionName: 'availableBalance',
    args: [asset as Address, account as Address],
  });
}

/** 預け入れの署名の内容。 */
export interface DepositAuthorization {
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: `0x${string}`;
  };
  types: typeof RECEIVE_TYPES;
  primaryType: 'ReceiveWithAuthorization';
  authorization: {
    from: string;
    to: string;
    value: string;
    validAfter: string;
    validBefore: string;
    nonce: string;
  };
}

/**
 * 預け入れの署名の内容を組み立てる。
 *
 * 受取先を取次のコントラクトに固定する。内部で呼ばれる `receiveWithAuthorization`
 * は受取先が呼び出し元であることを要求するため、この署名は取次のコントラクト
 * 経由でしか実行できない。第三者が署名を拾っても、預け入れ先は署名に書かれた
 * 本人のままで悪用できない。
 *
 * @param from 預け入れる利用者のアドレス
 * @param value 預け入れる額（資産の最小単位）
 * @param now 現在時刻をミリ秒で返す関数。テストから差し替える
 * @returns 署名する内容
 */
export function buildDepositAuthorization(
  from: string,
  value: bigint,
  now: () => number = Date.now,
): DepositAuthorization {
  const seconds = Math.floor(now() / 1000);

  return {
    domain: {
      ...ASSET_DOMAIN,
      chainId: ARC_CHAIN.id,
      verifyingContract: PAYMENT_ASSET as `0x${string}`,
    },
    types: RECEIVE_TYPES,
    primaryType: 'ReceiveWithAuthorization',
    authorization: {
      from,
      to: GATEWAY_WALLET,
      value: value.toString(),
      validAfter: '0',
      validBefore: String(seconds + VALIDITY_SECONDS),
      // 順序に依存しないランダムな値とする。連番では、利用者が別の場所で
      // 使用枠の署名を使った際に競合して無効になる。
      nonce: randomNonce(),
    },
  };
}

/** 預け入れの進み具合。 */
export type DepositStage = 'signing' | 'sending' | 'waiting' | 'done';

/** 預け入れの依存。 */
export interface DepositDeps {
  /** ウォレットのプロバイダ。 */
  ethereum: EthereumProvider;
  /** 預け入れる利用者のアドレス。 */
  address: string;
  /** 預け入れた残高を読む。 */
  readDeposit: (asset: string, account: string) => Promise<bigint>;
  /** 反映の確認の間隔（ミリ秒）。 */
  waitMs?: number;
  /** 反映の確認の上限回数。 */
  maxAttempts?: number;
  /** 進み具合の通知。 */
  onStage?: (stage: DepositStage) => void;
  /** 署名する内容の組み立て。テストから差し替える。 */
  build?: (from: string, value: bigint) => DepositAuthorization;
}

/** 預け入れの結果。 */
export type DepositResult =
  | { ok: true; transactionHash: string; balance: bigint }
  | { ok: false; message: string };

/**
 * 画面から預け入れる。
 *
 * 署名したうえで預け入れのトランザクションを 1 回送り、決済に使える残高へ
 * 反映されるまで待つ。トランザクションの確定と残高への反映は同時ではないため、
 * 確定しただけで完了としない。
 *
 * @param value 預け入れる額（資産の最小単位）
 * @param deps 依存
 * @returns 預け入れの結果
 */
export async function deposit(value: bigint, deps: DepositDeps): Promise<DepositResult> {
  const waitMs = deps.waitMs ?? 3000;
  const maxAttempts = deps.maxAttempts ?? 20;

  const before = await deps.readDeposit(PAYMENT_ASSET, deps.address);

  deps.onStage?.('signing');
  const built = (deps.build ?? buildDepositAuthorization)(deps.address, value);

  const signature = (await deps.ethereum.request({
    method: 'eth_signTypedData_v4',
    params: [
      deps.address,
      toSignTypedDataPayload(
        built.domain,
        built.types,
        built.primaryType,
        { ...built.authorization },
      ),
    ],
  })) as `0x${string}`;

  const { v, r, s } = parseSignature(signature);

  deps.onStage?.('sending');
  const transactionHash = (await deps.ethereum.request({
    method: 'eth_sendTransaction',
    params: [
      {
        from: deps.address,
        to: GATEWAY_WALLET,
        data: encodeFunctionData({
          abi: GATEWAY_WALLET_ABI,
          functionName: 'depositWithAuthorization',
          args: [
            PAYMENT_ASSET as Address,
            built.authorization.from as Address,
            BigInt(built.authorization.value),
            BigInt(built.authorization.validAfter),
            BigInt(built.authorization.validBefore),
            built.authorization.nonce as `0x${string}`,
            Number(v),
            r,
            s,
          ],
        }),
      },
    ],
  })) as string;

  // 取次は、トランザクションの確定と決済に使える残高への反映を別に扱う。
  // 確定しただけで完了と示すと、利用者はすぐに支払えると誤解する。
  deps.onStage?.('waiting');

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const balance = await deps.readDeposit(PAYMENT_ASSET, deps.address);

    if (balance > before) {
      deps.onStage?.('done');
      return { ok: true, transactionHash, balance };
    }

    await delay(waitMs);
  }

  return {
    ok: false,
    message:
      '預け入れは送信しましたが、決済に使える残高へ反映されませんでした。' +
      '時間をおいて残高を確認してください。',
  };
}

/**
 * 指定した時間だけ待つ。
 *
 * @param ms 待つ時間（ミリ秒）
 */
async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 使い捨ての nonce を作る。
 *
 * @returns 32 バイトの 16 進表記
 */
function randomNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));

  return `0x${[...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}
