import { createPublicClient, http, type Address, type Transport } from 'viem';
import { ARC_CHAIN } from './network.js';

import { ANCHOR_REGISTRY_ABI } from './abi.js';
import type { HexHash } from './hash.js';
import type { AnchorReader } from './verify.js';

/**
 * Arc メインネットの刻印のコントラクトへの照会。
 *
 * 照会は view 関数の呼び出しだけで完結し、イベントの走査を行わない。公式 RPC は
 * イベントの取得範囲に上限があり、稼働期間が長くなるほど走査の回数が増える。
 */

/** 照会の組み立てに用いる設定。 */
export interface RegistryReaderConfig {
  /** 刻印のコントラクトのアドレス。 */
  contractAddress: Address;
  /** RPC の URL。省略時はチェーン定義の既定値を用いる。 */
  rpcUrl?: string;
  /** 通信の実装。テストから差し替える。 */
  transport?: Transport;
}

/**
 * Arc メインネットへ照会する AnchorReader を組み立てる。
 *
 * @param config コントラクトのアドレスと通信の設定
 * @returns 刻印の照会
 */
export function createRegistryReader(config: RegistryReaderConfig): AnchorReader {
  const client = createPublicClient({
    chain: ARC_CHAIN,
    transport: config.transport ?? http(config.rpcUrl),
  });

  const contract = { address: config.contractAddress, abi: ANCHOR_REGISTRY_ABI } as const;

  async function assertChain(): Promise<void> {
    if (await client.getChainId() !== ARC_CHAIN.id) {
      throw new Error('刻印の照会先が Arc Mainnet と一致しません');
    }
  }

  return {
    chainId: ARC_CHAIN.id,
    contractAddress: config.contractAddress,

    async hashOf(date: number, revision: number): Promise<HexHash> {
      await assertChain();
      return client.readContract({ ...contract, functionName: 'hashOf', args: [date, revision] });
    },

    async latestRevisionOf(date: number): Promise<number> {
      await assertChain();
      return client.readContract({ ...contract, functionName: 'latestRevisionOf', args: [date] });
    },
  };
}
