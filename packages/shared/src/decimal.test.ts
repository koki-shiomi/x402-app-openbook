import { describe, expect, it } from 'vitest';

import {
  addDecimals,
  compareDecimals,
  divideDecimals,
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

describe('divideDecimals', () => {
  it('割り切れない場合は指定桁数へ四捨五入する', () => {
    expect(divideDecimals('20.00', '30', 6)).toBe('0.666667');
    expect(divideDecimals('20.00', '28', 6)).toBe('0.714286');
  });

  it('割り切れる場合も指定桁数へ揃える', () => {
    expect(divideDecimals('10', '2', 6)).toBe('5.000000');
  });

  it('小数を含む除数を扱える', () => {
    expect(divideDecimals('1', '0.5', 2)).toBe('2.00');
  });

  it('負の値を扱える', () => {
    expect(divideDecimals('-20.00', '30', 6)).toBe('-0.666667');
  });

  it('0 で除算すると例外を投げる', () => {
    expect(() => divideDecimals('1', '0', 6)).toThrow(/0/);
  });

  it('浮動小数点を経由しない', () => {
    // 1/3 を Number 経由で計算すると 0.3333333333333333 になり、
    // 10 進固定小数点での丸めと桁が揃わない。
    expect(divideDecimals('1', '3', 20)).toBe('0.33333333333333333333');
  });
});

describe('compareDecimals', () => {
  it('大小と等価を符号で返す', () => {
    expect(compareDecimals('2', '1')).toBe(1);
    expect(compareDecimals('1', '2')).toBe(-1);
    expect(compareDecimals('1', '1')).toBe(0);
  });

  it('小数桁数が異なっても値として比較する', () => {
    expect(compareDecimals('1.00', '1')).toBe(0);
    expect(compareDecimals('1.001', '1.00')).toBe(1);
  });

  it('負の値を扱える', () => {
    expect(compareDecimals('-1.00', '0.00')).toBe(-1);
    expect(compareDecimals('-0.00', '0')).toBe(0);
  });
});
