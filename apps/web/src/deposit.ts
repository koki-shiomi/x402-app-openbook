import { createPublicClient, http, type Address } from 'viem';
import { arcTestnet } from 'viem/chains';

import { GATEWAY_WALLET_ABI } from '@openbook/shared';

import { ARC_RPC_URL, GATEWAY_WALLET } from './config.js';

/**
 * 決済の取次へ預け入れた残高の照会。
 *
 * ウォレットが保有する残高ではなく、Gateway Wallet へ預け入れた分が決済に使える。
 * 署名を伴わない読み取りであり、ブラウザから直接チェーンへ問い合わせる。
 * 詳細は design.md の決定 4 を参照。
 */

/**
 * 預け入れた残高を読む。
 *
 * @param asset 決済に用いる資産のアドレス
 * @param account 支払い元のアドレス
 * @returns 資産の最小単位での残高
 */
export async function readDeposit(asset: string, account: string): Promise<bigint> {
  const client = createPublicClient({ chain: arcTestnet, transport: http(ARC_RPC_URL) });

  return await client.readContract({
    address: GATEWAY_WALLET as Address,
    abi: GATEWAY_WALLET_ABI,
    functionName: 'availableBalance',
    args: [asset as Address, account as Address],
  });
}
