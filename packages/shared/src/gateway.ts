/**
 * 決済の取次が用いる Gateway Wallet への照会。
 *
 * 決済に使える残高は、ウォレットが保有する残高ではなく、このコントラクトへ
 * 預け入れた分である。預け入れが足りないと、署名を終えて要求を送った後に
 * 取次から拒まれるため、署名を求める前に確かめる。
 *
 * デプロイ済みのコントラクトへ問い合わせて、0.5 USDC を預け入れた後の
 * `availableBalance` が 500000 を示し、0.10 USDC を支払った後に 400000 へ
 * 減ることを確認している。`withdrawableBalance` は引き出しの待機期間を表す
 * 別の値であり、支払いの可否の判定には用いない。
 */

/**
 * 残高の照会と預け入れに用いる範囲の ABI。
 *
 * 預け入れには `depositWithAuthorization` を用いる。事前に使用枠を与える
 * トランザクションを要さず、EIP-3009 の署名 1 つで済む。内部で呼ばれるのは
 * `receiveWithAuthorization` であり、受取先が呼び出し元であることを要求する
 * ため、この署名はこのコントラクト経由でしか実行できない。
 */
export const GATEWAY_WALLET_ABI = [
  {
    type: 'function',
    name: 'availableBalance',
    inputs: [
      { name: 'token', type: 'address', internalType: 'address' },
      { name: 'depositor', type: 'address', internalType: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'depositWithAuthorization',
    inputs: [
      { name: 'token', type: 'address', internalType: 'address' },
      { name: 'from', type: 'address', internalType: 'address' },
      { name: 'value', type: 'uint256', internalType: 'uint256' },
      { name: 'validAfter', type: 'uint256', internalType: 'uint256' },
      { name: 'validBefore', type: 'uint256', internalType: 'uint256' },
      { name: 'nonce', type: 'bytes32', internalType: 'bytes32' },
      { name: 'v', type: 'uint8', internalType: 'uint8' },
      { name: 'r', type: 'bytes32', internalType: 'bytes32' },
      { name: 's', type: 'bytes32', internalType: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;
