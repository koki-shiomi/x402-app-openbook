import { defineChain } from 'viem';

/** API・画面・第三者検証が共有するメインネットの定義。 */
export const ARC_CHAIN = defineChain({
  id: 5042,
  name: 'Arc Mainnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.mainnet.arc.io'] } },
  blockExplorers: { default: { name: 'Arc Explorer', url: 'https://explorer.arc.io' } },
});

/** 秘密鍵や認証情報を含まない公開設定。 */
export const ARC_NETWORK = {
  anchorContract: '0xC039722204Dde6DF3dFb48a9a3068163d30b997a',
  paymentNetwork: `eip155:${ARC_CHAIN.id}`,
  paymentAsset: '0x3600000000000000000000000000000000000000',
  gatewayWallet: '0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE',
  facilitatorUrl: 'https://gateway-api.circle.com/v1/x402',
} as const;
