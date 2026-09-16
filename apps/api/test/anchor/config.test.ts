import { describe, expect, it } from 'vitest';

import { loadAnchorConfig } from '../../src/anchor/config.js';

const FULL = {
  ARC_SIGNER_PRIVATE_KEY:
    '0x1111111111111111111111111111111111111111111111111111111111111111',
  ARC_RPC_URL: 'https://rpc.testnet.arc.io',
  ARC_ANCHOR_CONTRACT: '0xC039722204Dde6DF3dFb48a9a3068163d30b997a',
};

describe('刻印の設定の読み取り', () => {
  it('3 つがそろえば設定が得られる', () => {
    const result = loadAnchorConfig(FULL);

    expect(result.config).toEqual({
      signerPrivateKey: FULL.ARC_SIGNER_PRIVATE_KEY,
      rpcUrl: FULL.ARC_RPC_URL,
      contractAddress: FULL.ARC_ANCHOR_CONTRACT,
    });
    expect(result.missing).toEqual([]);
  });

  it('未設定の項目名を返す', () => {
    const { ARC_RPC_URL: _omit, ...partial } = FULL;

    const result = loadAnchorConfig({ ...partial, ARC_ANCHOR_CONTRACT: '' });

    expect(result.config).toBeUndefined();
    expect(result.missing).toEqual(['ARC_RPC_URL', 'ARC_ANCHOR_CONTRACT']);
  });

  it('何も設定されていなければ 3 つとも返す', () => {
    const result = loadAnchorConfig({});

    expect(result.missing).toEqual([
      'ARC_SIGNER_PRIVATE_KEY',
      'ARC_RPC_URL',
      'ARC_ANCHOR_CONTRACT',
    ]);
  });
});
