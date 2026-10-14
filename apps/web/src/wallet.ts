import { ARC_RPC_URL } from './config.js';
import { ARC_CHAIN } from '@openbook/shared';
import type { EthereumProvider } from './preconditions.js';

/**
 * ウォレットとのやり取り。
 *
 * 秘密鍵は画面へ入力させず、保持もしない。署名はウォレットの中で行われる。
 * 詳細は specs/public-dashboard/spec.md の「ウォレットによる支払い」を参照。
 */

/** ウォレットが未登録のチェーンへの切り替えを拒むときの符号。 */
const UNRECOGNIZED_CHAIN = 4902;

/**
 * ブラウザに注入されたウォレットを取り出す。
 *
 * @param scope 走査する対象。通常は `window`
 * @returns ウォレットのプロバイダ。無ければ undefined
 */
export function findProvider(scope: {
  ethereum?: unknown;
}): EthereumProvider | undefined {
  const candidate = scope.ethereum;
  if (candidate === undefined || candidate === null) {
    return undefined;
  }

  return candidate as EthereumProvider;
}

/**
 * ウォレットへ接続を要求し、アドレスを得る。
 *
 * @param ethereum ウォレットのプロバイダ
 * @returns 接続したアドレス
 * @throws 接続を拒まれた場合
 */
export async function connect(ethereum: EthereumProvider): Promise<string> {
  const accounts = (await ethereum.request({ method: 'eth_requestAccounts' })) as string[];
  const address = accounts[0];

  if (address === undefined) {
    throw new Error('ウォレットがアドレスを返しませんでした');
  }

  return address;
}

/**
 * 接続先を目的のチェーンに合わせる。
 *
 * ウォレットが当該チェーンを知らない場合は追加を要求する。利用者が追加を拒んだ
 * 場合は、手動で登録できるよう画面側で値を示す必要があるため、失敗として返す。
 *
 * @param ethereum ウォレットのプロバイダ
 * @param chainId 目的のチェーン ID
 * @throws 切り替えも追加もできなかった場合
 */
export async function ensureChain(
  ethereum: EthereumProvider,
  chainId: number,
): Promise<void> {
  const current = Number.parseInt(
    (await ethereum.request({ method: 'eth_chainId' })) as string,
    16,
  );

  if (current === chainId) {
    return;
  }

  const hexChainId = `0x${chainId.toString(16)}`;

  try {
    await ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: hexChainId }],
    });
    return;
  } catch (error) {
    if ((error as { code?: number }).code !== UNRECOGNIZED_CHAIN) {
      throw error;
    }
  }

  await ethereum.request({
    method: 'wallet_addEthereumChain',
    params: [
      {
        chainId: hexChainId,
        chainName: ARC_CHAIN.name,
        rpcUrls: [ARC_RPC_URL],
        nativeCurrency: ARC_CHAIN.nativeCurrency,
        blockExplorerUrls: [ARC_CHAIN.blockExplorers.default.url],
      },
    ],
  });
}
