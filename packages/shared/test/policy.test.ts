import { describe, expect, it } from 'vitest';

import { isWithinRevisionThreshold } from '../src/policy.js';

describe('訂正リビジョンを見送る閾値', () => {
  it('差が 1 円以下かつ比率が 1% 以下なら見送る', () => {
    expect(isWithinRevisionThreshold('1000.00', '1000.50')).toBe(true);
  });

  it('差が 1 円を超えるなら見送らない', () => {
    expect(isWithinRevisionThreshold('1000.00', '1002.00')).toBe(false);
  });

  it('比率が 1% を超えるなら見送らない', () => {
    expect(isWithinRevisionThreshold('10.00', '10.50')).toBe(false);
  });

  it('既存の値が 0 なら金額の変化で必ず見送らない', () => {
    expect(isWithinRevisionThreshold('0.00', '0.50')).toBe(false);
  });

  it('差と比率がちょうど上限なら見送る', () => {
    expect(isWithinRevisionThreshold('100.00', '101.00')).toBe(true);
  });

  it('値が減る向きの変化も同じ基準で判定する', () => {
    expect(isWithinRevisionThreshold('1000.00', '999.50')).toBe(true);
    expect(isWithinRevisionThreshold('10.00', '9.50')).toBe(false);
  });

  it('変化がなければ既存の値が 0 でも見送る', () => {
    expect(isWithinRevisionThreshold('0.00', '0.00')).toBe(true);
  });
});

