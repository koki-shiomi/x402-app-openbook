import { describe, expect, it } from 'vitest';

import { sha256Hex } from '../src/hash.js';

const encoder = new TextEncoder();

describe('sha256Hex', () => {
  it('sha256sum と同じ値を返す', async () => {
    expect(await sha256Hex(encoder.encode('abc'))).toBe(
      '0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('空のバイト列を扱える', async () => {
    expect(await sha256Hex(new Uint8Array())).toBe(
      '0xe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('レコードのバイト列に対して sha256sum と同じ値を返す', async () => {
    expect(await sha256Hex(encoder.encode('{"date":"2026-09-13","revision":1}'))).toBe(
      '0x7b1599ffeebac34da7e4cbb63730b063b1b3cf17e9afc272fe37485c16291c87',
    );
  });
});
