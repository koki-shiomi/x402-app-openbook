import { decodeFunctionData, custom, pad, toHex } from 'viem';
import { describe, expect, it } from 'vitest';

import { ANCHOR_REGISTRY_ABI } from '../src/abi.js';
import { createRegistryReader } from '../src/reader.js';

const CONTRACT = '0xC039722204Dde6DF3dFb48a9a3068163d30b997a';
const HASH = '0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

/** eth_call の要求を記録し、与えた戻り値を返すトランスポート。 */
function stubTransport(result: `0x${string}`) {
  const calls: { to: string; data: `0x${string}` }[] = [];
  const transport = custom({
    async request({ method, params }: { method: string; params: unknown[] }) {
      if (method === 'eth_chainId') {
        return toHex(5042);
      }
      if (method === 'eth_call') {
        const [call] = params as [{ to: string; data: `0x${string}` }];
        calls.push(call);
        return result;
      }
      throw new Error(`想定しない要求です: ${method}`);
    },
  });

  return { transport, calls };
}

describe('viem を用いた刻印の照会', () => {
  it('同じアドレスでも旧ネットワークを照会先として受け入れない', async () => {
    let calls = 0;
    const transport = custom({ async request({ method }) {
      if (method === 'eth_chainId') return toHex(5042002);
      calls++;
      return HASH;
    } });
    const reader = createRegistryReader({ contractAddress: CONTRACT, transport });
    await expect(reader.hashOf(20261003, 1)).rejects.toThrow('Arc Mainnet');
    await expect(reader.latestRevisionOf(20261003)).rejects.toThrow('Arc Mainnet');
    expect(calls).toBe(0);
  });
  it('チェーン ID とコントラクトのアドレスを公開する', () => {
    const { transport } = stubTransport(HASH);
    const reader = createRegistryReader({ contractAddress: CONTRACT, transport });

    expect(reader.chainId).toBe(5042);
    expect(reader.contractAddress).toBe(CONTRACT);
  });

  it('ハッシュの照会がコントラクトの hashOf を呼ぶ', async () => {
    const { transport, calls } = stubTransport(HASH);
    const reader = createRegistryReader({ contractAddress: CONTRACT, transport });

    expect(await reader.hashOf(20260913, 2)).toBe(HASH);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.to?.toLowerCase()).toBe(CONTRACT.toLowerCase());
    expect(decodeFunctionData({ abi: ANCHOR_REGISTRY_ABI, data: calls[0]!.data })).toEqual({
      functionName: 'hashOf',
      args: [20260913, 2],
    });
  });

  it('最大のリビジョンの照会が latestRevisionOf を呼ぶ', async () => {
    const { transport, calls } = stubTransport(pad(toHex(3), { size: 32 }));
    const reader = createRegistryReader({ contractAddress: CONTRACT, transport });

    expect(await reader.latestRevisionOf(20260913)).toBe(3);

    expect(decodeFunctionData({ abi: ANCHOR_REGISTRY_ABI, data: calls[0]!.data })).toEqual({
      functionName: 'latestRevisionOf',
      args: [20260913],
    });
  });
});
