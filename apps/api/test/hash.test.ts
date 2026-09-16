import { describe, expect, it } from 'vitest';

import { sha256Hex } from '@openbook/shared';

/** Workers の実行環境（workerd）でも同じ実装が動くことを確かめる。 */
describe('workerd 上の sha256Hex', () => {
  it('sha256sum と同じ値を返す', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe(
      '0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
