import { describe, expect, it } from 'vitest';

import { createRegistryReader, sha256Hex, verifyAnchoredRecord } from '@openbook/shared';

/**
 * 共有パッケージがブラウザで動くことの確認。
 *
 * 検証関数と刻印の照会は Workers 向けに書かれているが、⑥では同じものを
 * ブラウザで用いる。束ねに含められることと、Web Crypto で算出した値が
 * 一般的な道具の出力と一致することを、実ブラウザ上で確かめる。
 */

describe('共有パッケージのブラウザでの動作', () => {
  it('SHA-256 が sha256sum の出力と一致する', async () => {
    const bytes = new TextEncoder().encode('sizet-openbook');

    // `printf 'sizet-openbook' | sha256sum` の出力。
    expect(await sha256Hex(bytes)).toBe(
      '0x5b35864f2c257b983ab10d35ba002fba35a317513df824175786ecd89727e5c5',
    );
  });

  it('検証関数を呼び出せる', async () => {
    const record = { date: '2026-09-14', revision: 1 };
    const bytes = new TextEncoder().encode(JSON.stringify(record));
    const hash = await sha256Hex(bytes);

    const result = await verifyAnchoredRecord(bytes, {
      chainId: 5042,
      contractAddress: '0xC039722204Dde6DF3dFb48a9a3068163d30b997a',
      async hashOf() {
        return hash;
      },
      async latestRevisionOf() {
        return 1;
      },
    });

    expect(result).toEqual(
      expect.objectContaining({ kind: 'classified', status: 'current' }),
    );
  });

  it('刻印の照会を組み立てられる', () => {
    const reader = createRegistryReader({
      contractAddress: '0xC039722204Dde6DF3dFb48a9a3068163d30b997a',
      rpcUrl: 'https://rpc.mainnet.arc.io',
    });

    expect(reader.chainId).toBe(5042);
    expect(reader.contractAddress).toBe('0xC039722204Dde6DF3dFb48a9a3068163d30b997a');
  });
});
