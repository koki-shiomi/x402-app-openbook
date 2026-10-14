import { describe, expect, it } from 'vitest';
import { ARC_CHAIN, ARC_NETWORK } from '../src/network.js';

describe('メインネットの共通設定', () => {
  it('署名・RPC・検証先が同じチェーンに揃う', () => {
    expect(ARC_CHAIN.id).toBe(5042);
    expect(ARC_NETWORK.paymentNetwork).toBe('eip155:5042');
    expect(ARC_CHAIN.rpcUrls.default.http).toEqual(['https://rpc.mainnet.arc.io']);
    expect(ARC_CHAIN.nativeCurrency).toEqual({ name: 'USDC', symbol: 'USDC', decimals: 18 });
    expect(ARC_CHAIN.blockExplorers?.default.url).toBe('https://explorer.arc.io');
    expect(ARC_NETWORK.anchorContract).toBe('0xC039722204Dde6DF3dFb48a9a3068163d30b997a');
    expect(ARC_NETWORK.gatewayWallet).toBe('0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE');
  });
});
