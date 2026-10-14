import { describe, expect, it } from 'vitest';

import { loadPaymentConfig } from '../../src/payment/config.js';

const FULL = {
  X402_FACILITATOR_URL: 'https://gateway-api.circle.com/v1/x402',
  X402_PAY_TO: '0xd77dd307A9E395fB2680011deeD994A27cf70d4b',
  X402_PRICE_USDC: '0.10',
};

describe('決済の設定の読み取り', () => {
  it('運営者指定の刻印 EOA と受取先の共用を許す', () => {
    expect(loadPaymentConfig(FULL).config?.payTo).toBe('0xd77dd307A9E395fB2680011deeD994A27cf70d4b');
  });

  it('3 つがそろえば設定が得られる', () => {
    const result = loadPaymentConfig(FULL);

    expect(result.config).toEqual({
      facilitatorUrl: FULL.X402_FACILITATOR_URL,
      payTo: FULL.X402_PAY_TO,
      priceUsdc: '0.10',
    });
    expect(result.missing).toEqual([]);
  });

  it('未設定の項目名を返す', () => {
    const { X402_PAY_TO: _omit, ...partial } = FULL;

    const result = loadPaymentConfig({ ...partial, X402_PRICE_USDC: '' });

    expect(result.config).toBeUndefined();
    expect(result.missing).toEqual(['X402_PAY_TO', 'X402_PRICE_USDC']);
  });

  it('何も設定されていなければ 3 つとも返す', () => {
    const result = loadPaymentConfig({});

    expect(result.missing).toEqual([
      'X402_FACILITATOR_URL',
      'X402_PAY_TO',
      'X402_PRICE_USDC',
    ]);
  });

  it('価格が 10 進小数として不正なら設定誤りとして扱う', () => {
    const result = loadPaymentConfig({ ...FULL, X402_PRICE_USDC: '0.1.0' });

    expect(result.config).toBeUndefined();
    expect(result.missing).toEqual([]);
    expect(result.invalid).toMatch(/X402_PRICE_USDC/);
  });

  it('価格が負の値なら設定誤りとして扱う', () => {
    const result = loadPaymentConfig({ ...FULL, X402_PRICE_USDC: '-0.10' });

    expect(result.config).toBeUndefined();
    expect(result.invalid).toMatch(/X402_PRICE_USDC/);
  });

  it('価格が 0 なら設定誤りとして扱う', () => {
    const result = loadPaymentConfig({ ...FULL, X402_PRICE_USDC: '0' });

    expect(result.config).toBeUndefined();
    expect(result.invalid).toMatch(/X402_PRICE_USDC/);
  });
});
