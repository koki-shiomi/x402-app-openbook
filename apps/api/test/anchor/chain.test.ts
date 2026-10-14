import { custom, parseTransaction, toHex, type Hex } from 'viem';
import { describe, expect, it } from 'vitest';

import { createAnchorChain } from '../../src/anchor/chain.js';

const CONFIG = {
  signerPrivateKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  rpcUrl: 'https://rpc.mainnet.arc.io',
  contractAddress: '0xC039722204Dde6DF3dFb48a9a3068163d30b997a',
};

const TX_HASH = '0x1111111111111111111111111111111111111111111111111111111111111111';

/**
 * 送信されたトランザクションを捕まえるトランスポート。
 *
 * @param baseFeePerGas ブロックが示す基礎手数料
 * @returns トランスポートと、捕まえた署名済みトランザクション
 */
function capturingTransport(baseFeePerGas: bigint) {
  const sent: Hex[] = [];

  const transport = custom({
    async request({ method, params }: { method: string; params: unknown[] }) {
      switch (method) {
        case 'eth_chainId':
          return toHex(5042);
        case 'eth_getBlockByNumber':
          return { baseFeePerGas: toHex(baseFeePerGas), number: toHex(100), timestamp: toHex(1) };
        case 'eth_maxPriorityFeePerGas':
          return toHex(1_000_000n);
        case 'eth_getTransactionCount':
          return toHex(7);
        case 'eth_estimateGas':
          return toHex(100_000);
        case 'eth_sendRawTransaction':
          sent.push((params as [Hex])[0]);
          return TX_HASH;
        case 'eth_getTransactionReceipt':
          return {
            status: '0x1',
            transactionHash: TX_HASH,
            blockNumber: toHex(4321),
            blockHash: TX_HASH,
            transactionIndex: '0x0',
            from: '0x0000000000000000000000000000000000000001',
            to: CONFIG.contractAddress,
            cumulativeGasUsed: toHex(100_000),
            gasUsed: toHex(100_000),
            logs: [],
            logsBloom: `0x${'0'.repeat(512)}`,
            type: '0x2',
            effectiveGasPrice: toHex(baseFeePerGas),
            contractAddress: null,
          };
        default:
          throw new Error(`想定しない要求です: ${method}`);
      }
    },
  });

  return { transport, sent };
}

describe('刻印の送信', () => {
  it('基礎手数料が低くても maxFeePerGas は 20 Gwei を下回らない', async () => {
    const { transport, sent } = capturingTransport(1n);
    const chain = createAnchorChain(CONFIG, transport);

    await chain.anchor([{ date: '2026-09-15', revision: 1, hash: TX_HASH }]);

    expect(parseTransaction(sent[0]!).maxFeePerGas).toBe(20_000_000_000n);
  });

  it('基礎手数料が高い場合は見積もりに従う', async () => {
    const { transport, sent } = capturingTransport(100_000_000_000n);
    const chain = createAnchorChain(CONFIG, transport);

    await chain.anchor([{ date: '2026-09-15', revision: 1, hash: TX_HASH }]);

    expect(parseTransaction(sent[0]!).maxFeePerGas!).toBeGreaterThan(100_000_000_000n);
  });

  it('成立したトランザクションのハッシュとブロック番号を返す', async () => {
    const { transport } = capturingTransport(20_000_000_000n);
    const chain = createAnchorChain(CONFIG, transport);

    expect(await chain.anchor([{ date: '2026-09-15', revision: 1, hash: TX_HASH }])).toEqual({
      transactionHash: TX_HASH,
      blockNumber: 4321,
    });
  });
});
