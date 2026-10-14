import { ANCHOR_CHAIN_ID, ARC_RPC_URL, GATEWAY_WALLET } from './config.js';
import type { PaymentTerms } from './api.js';

/**
 * 支払いの事前条件の判定。
 *
 * 預け入れ不足と自己送金は、いずれも署名を終えて要求を送ってから取次に拒まれる。
 * 利用者は署名の手間をかけた末に、原因の分からない失敗を受け取ることになる。
 * チェーンの読み取りは署名を伴わないため、先に確かめて理由を示す。
 * 詳細は specs/public-dashboard/spec.md の「支払いの事前条件の提示」を参照。
 */

/** 画面が用いる範囲の EIP-1193 プロバイダ。 */
export interface EthereumProvider {
  request(request: { method: string; params?: unknown[] }): Promise<unknown>;
}

/** 判定の依存。テストから差し替える。 */
export interface PreconditionDeps {
  /** ウォレットのプロバイダ。 */
  ethereum: EthereumProvider;
  /** 決済の取次へ預け入れた残高を読む。 */
  readDeposit: (asset: string, account: string) => Promise<bigint>;
}

/** 満たさない事前条件の種類。 */
export type PreconditionFailure =
  | 'no-wallet'
  | 'not-connected'
  | 'wrong-chain'
  | 'self-transfer'
  | 'insufficient-deposit';

/** 判定の結果。 */
export type PreconditionResult =
  | { ok: true; address: string }
  | {
      ok: false;
      reason: PreconditionFailure;
      message: string;
      details?: Record<string, unknown>;
    };

/**
 * 支払いへ進めるかを判定する。
 *
 * 満たさないものが見つかった時点で、理由と必要な操作を添えて返す。署名は求めない。
 *
 * @param terms API が提示した支払いの条件
 * @param deps 判定の依存
 * @returns 判定の結果
 */
export async function checkPreconditions(
  terms: PaymentTerms,
  deps: PreconditionDeps,
): Promise<PreconditionResult> {
  const accounts = (await deps.ethereum.request({ method: 'eth_accounts' })) as string[];
  const address = accounts[0];

  if (address === undefined) {
    return {
      ok: false,
      reason: 'not-connected',
      message: 'ウォレットを接続してください。',
    };
  }

  const expectedChainId = chainIdOf(terms.network);
  const chainId = Number.parseInt(
    (await deps.ethereum.request({ method: 'eth_chainId' })) as string,
    16,
  );

  if (chainId !== expectedChainId) {
    return {
      ok: false,
      reason: 'wrong-chain',
      message: `接続先を Arc Mainnet へ切り替えてください。`,
      // ウォレットが当該チェーンを知らない場合に、手動で追加できるようにする。
      details: {
        chainId: expectedChainId,
        rpcUrl: ARC_RPC_URL,
        currencySymbol: 'USDC',
      },
    };
  }

  if (address.toLowerCase() === terms.payTo.toLowerCase()) {
    return {
      ok: false,
      reason: 'self-transfer',
      message:
        '支払い元が受取先と同じアドレスです。別のアドレスで接続してください。',
    };
  }

  const deposited = await deps.readDeposit(terms.asset, address);
  if (deposited < BigInt(terms.amount)) {
    return {
      ok: false,
      reason: 'insufficient-deposit',
      message:
        '決済に使える残高が足りません。ウォレットに USDC があっても、' +
        'Circle の Gateway Wallet へ預け入れた分だけが決済に使えます。',
      details: {
        gatewayWallet: GATEWAY_WALLET,
        required: terms.amount,
        deposited: deposited.toString(),
      },
    };
  }

  return { ok: true, address };
}

/**
 * CAIP-2 のネットワーク表記からチェーン ID を取り出す。
 *
 * @param network `eip155:5042` の形の表記
 * @returns チェーン ID
 */
function chainIdOf(network: string): number {
  const parsed = Number.parseInt(network.split(':')[1] ?? '', 10);
  return Number.isNaN(parsed) ? ANCHOR_CHAIN_ID : parsed;
}
