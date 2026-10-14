import { ANCHOR_REGISTRY_ABI, ARC_CHAIN, type HexHash } from '@openbook/shared';
import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Transport,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import type { AnchorConfig } from './config.js';
import type { ChainState, PreparedTarget } from './reconcile.js';
import type { AnchorTarget } from './targets.js';

/**
 * Arc メインネットへの照会と刻印の送信。
 *
 * 照会と送信を 1 つのインタフェースにまとめ、テストではメモリ上の実装を渡す。
 * 詳細は specs/hash-anchoring/spec.md を参照。
 */

/** 刻印を送る先のチェーンが満たすべき ID。誤った RPC への送信を防ぐ。 */
export const EXPECTED_CHAIN_ID = ARC_CHAIN.id;

/**
 * 手数料の下限。Arc の公式ドキュメントは `maxFeePerGas` を 20 Gwei 以上にするよう
 * 求めており、下回るとエラーを返さずに破棄されうる。
 */
const MIN_MAX_FEE_PER_GAS = 20_000_000_000n;

/** 受領を待つ上限。ファイナリティは 1 秒未満のため、これを超える場合は異常とみなす。 */
const RECEIPT_TIMEOUT_MS = 60_000;

/** 刻印の送信が成立したときの結果。 */
export interface AnchorTransaction {
  /** トランザクションのハッシュ。 */
  transactionHash: string;
  /** 取り込まれたブロック番号。 */
  blockNumber: number;
}

/** チェーンへの照会と送信。 */
export interface AnchorChain {
  /** 刻印のコントラクトのアドレス。 */
  contractAddress: string;
  /** 接続先のチェーン ID を返す。 */
  chainId(): Promise<number>;
  /** 対象ごとのチェーン上の状態を返す。 */
  readStates(targets: readonly AnchorTarget[]): Promise<ChainState[]>;
  /** 刻印を 1 件のトランザクションで送り、成立を待つ。 */
  anchor(items: readonly PreparedTarget[]): Promise<AnchorTransaction>;
}

/**
 * 対象日を YYYYMMDD 形式の整数に直す。コントラクトはこの形式で刻印を保持する。
 *
 * @param date 対象日（YYYY-MM-DD 形式）
 * @returns YYYYMMDD 形式の整数
 */
function toDateNumber(date: string): number {
  return Number(date.replaceAll('-', ''));
}

/**
 * Arc メインネットへ接続する AnchorChain を組み立てる。
 *
 * 照会は viem のマルチコールで 1 回の呼び出しにまとめる。
 *
 * @param config 署名鍵・RPC・コントラクトのアドレス
 * @param transport 通信の実装。省略時は設定の RPC へ HTTP で接続する
 * @returns チェーンへの照会と送信
 */
export function createAnchorChain(config: AnchorConfig, transport?: Transport): AnchorChain {
  const account = privateKeyToAccount(config.signerPrivateKey as HexHash);
  const address = config.contractAddress as Address;
  const resolved = transport ?? http(config.rpcUrl);

  const publicClient = createPublicClient({
    chain: ARC_CHAIN,
    transport: resolved,
    batch: { multicall: true },
  });
  const walletClient = createWalletClient({ account, chain: ARC_CHAIN, transport: resolved });

  const contract = { address, abi: ANCHOR_REGISTRY_ABI } as const;

  return {
    contractAddress: config.contractAddress,

    async chainId(): Promise<number> {
      return publicClient.getChainId();
    },

    async readStates(targets: readonly AnchorTarget[]): Promise<ChainState[]> {
      return Promise.all(
        targets.map(async (target) => {
          const date = toDateNumber(target.date);
          const [anchoredHash, latestRevision] = await Promise.all([
            publicClient.readContract({
              ...contract,
              functionName: 'hashOf',
              args: [date, target.revision],
            }),
            publicClient.readContract({
              ...contract,
              functionName: 'latestRevisionOf',
              args: [date],
            }),
          ]);

          return { anchoredHash, latestRevision };
        }),
      );
    },

    async anchor(items: readonly PreparedTarget[]): Promise<AnchorTransaction> {
      const fees = await publicClient.estimateFeesPerGas();
      const maxFeePerGas =
        fees.maxFeePerGas > MIN_MAX_FEE_PER_GAS ? fees.maxFeePerGas : MIN_MAX_FEE_PER_GAS;

      const transactionHash = await walletClient.writeContract({
        ...contract,
        functionName: 'anchor',
        args: [
          items.map((item) => ({
            date: toDateNumber(item.date),
            revision: item.revision,
            recordHash: item.hash as HexHash,
          })),
        ],
        maxFeePerGas,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      });

      const receipt = await publicClient.waitForTransactionReceipt({
        hash: transactionHash,
        timeout: RECEIPT_TIMEOUT_MS,
      });

      if (receipt.status !== 'success') {
        throw new Error(`刻印のトランザクションが失敗しました: ${transactionHash}`);
      }

      return { transactionHash: receipt.transactionHash, blockNumber: Number(receipt.blockNumber) };
    },
  };
}
