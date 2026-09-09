import { describe, expect, it } from 'vitest';

import {
  addDecimals,
  isDecimalString,
  multiplyDecimals,
  roundHalfUp,
  subtractDecimals,
} from './decimal.js';

describe('isDecimalString', () => {
  it.each(['0', '-1', '1.0071', '0.000001', '-0.5'])('%s を妥当と判定する', (value) => {
    expect(isDecimalString(value)).toBe(true);
  });

  it.each(['', '.', '1.', '.1', '1.2.3', 'NaN', '1e3', ' 1', '+1'])(
    '%s を不正と判定する',
    (value) => {
      expect(isDecimalString(value)).toBe(false);
    },
  );
});

describe('addDecimals', () => {
  it('小数桁数が異なる値を加算する', () => {
    expect(addDecimals(['1.0071', '0.189'])).toBe('1.1961');
  });

  it('浮動小数点では誤差が出る組み合わせでも正確に加算する', () => {
    expect(addDecimals(['0.1', '0.2'])).toBe('0.3');
  });

  it('空配列は 0 を返す', () => {
    expect(addDecimals([])).toBe('0');
  });

  it('負の値を扱える', () => {
    expect(addDecimals(['10.00', '-3.50'])).toBe('6.50');
  });
});

describe('subtractDecimals', () => {
  it('収益から費用を引いて損益を求める', () => {
    expect(subtractDecimals('100.00', '250.75')).toBe('-150.75');
  });
});

describe('roundHalfUp', () => {
  it('小数第 3 位を四捨五入して第 2 位までにする', () => {
    expect(roundHalfUp('1.005', 2)).toBe('1.01');
    expect(roundHalfUp('1.004', 2)).toBe('1.00');
  });

  it('負の値は絶対値が大きくなる向きに丸める', () => {
    expect(roundHalfUp('-1.005', 2)).toBe('-1.01');
  });

  it('桁数が足りない値はゼロ詰めする', () => {
    expect(roundHalfUp('7', 2)).toBe('7.00');
  });

  it('指定桁数がちょうどの値は変化しない', () => {
    expect(roundHalfUp('12.34', 2)).toBe('12.34');
  });

  it('丸め後に繰り上がる', () => {
    expect(roundHalfUp('9.999', 2)).toBe('10.00');
  });
});

describe('multiplyDecimals', () => {
  it('小数桁数は両者の和になる', () => {
    expect(multiplyDecimals('0.010071', '147.25')).toBe('1.48295475');
  });

  it('整数どうしを乗算できる', () => {
    expect(multiplyDecimals('12', '3')).toBe('36');
  });

  it('負の値を扱える', () => {
    expect(multiplyDecimals('-1.5', '2.0')).toBe('-3.00');
  });
});
