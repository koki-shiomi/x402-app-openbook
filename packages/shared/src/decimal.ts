/**
 * 金額を扱うための 10 進固定小数点演算。
 *
 * 金額は 2 進浮動小数点を経由すると誤差が入るため、10 進小数の文字列として保持し、
 * 演算は BigInt による整数演算で行う。詳細は design.md の決定 4 を参照。
 */

const DECIMAL_PATTERN = /^-?\d+(\.\d+)$|^-?\d+$/;

/** 符号付きの仮数と小数桁数に分解した 10 進数。 */
interface ParsedDecimal {
  /** 小数点を取り除いた符号付き整数。 */
  unscaled: bigint;
  /** 小数点以下の桁数。 */
  scale: number;
}

/**
 * 10 進小数の文字列として妥当かを判定する。
 *
 * 指数表記・前後の空白・明示的な正符号は、直列化の結果が一意に定まらないため許容しない。
 *
 * @param value 判定対象の文字列
 * @returns 妥当な 10 進小数の文字列なら true
 */
export function isDecimalString(value: string): boolean {
  return DECIMAL_PATTERN.test(value);
}

/**
 * 10 進小数の文字列を仮数と小数桁数に分解する。
 *
 * @param value 10 進小数の文字列
 * @returns 分解結果
 * @throws {TypeError} 文字列が 10 進小数として不正な場合
 */
function parse(value: string): ParsedDecimal {
  if (!isDecimalString(value)) {
    throw new TypeError(`10 進小数として不正な値です: ${value}`);
  }

  const separatorIndex = value.indexOf('.');
  if (separatorIndex === -1) {
    return { unscaled: BigInt(value), scale: 0 };
  }

  const fraction = value.slice(separatorIndex + 1);
  return {
    unscaled: BigInt(value.slice(0, separatorIndex) + fraction),
    scale: fraction.length,
  };
}

/**
 * 仮数と小数桁数から 10 進小数の文字列を組み立てる。
 *
 * @param unscaled 小数点を取り除いた符号付き整数
 * @param scale 小数点以下の桁数
 * @returns 10 進小数の文字列
 */
function format(unscaled: bigint, scale: number): string {
  if (scale === 0) {
    return unscaled.toString();
  }

  const isNegative = unscaled < 0n;
  const digits = (isNegative ? -unscaled : unscaled).toString().padStart(scale + 1, '0');
  const integerPart = digits.slice(0, digits.length - scale);
  const fractionPart = digits.slice(digits.length - scale);

  return `${isNegative ? '-' : ''}${integerPart}.${fractionPart}`;
}

/**
 * 仮数を指定の小数桁数へ揃える。
 *
 * @param parsed 分解済みの 10 進数
 * @param scale 揃える先の小数桁数（現在の桁数以上であること）
 * @returns 揃えた後の仮数
 */
function rescale(parsed: ParsedDecimal, scale: number): bigint {
  return parsed.unscaled * 10n ** BigInt(scale - parsed.scale);
}

/**
 * 10 進小数を加算する。小数桁数が異なる場合は大きいほうに揃える。
 *
 * @param values 加算する 10 進小数の文字列の配列
 * @returns 合計値の 10 進小数の文字列。空配列の場合は "0"
 */
export function addDecimals(values: readonly string[]): string {
  if (values.length === 0) {
    return '0';
  }

  const parsed = values.map(parse);
  const scale = Math.max(...parsed.map((entry) => entry.scale));
  const total = parsed.reduce((sum, entry) => sum + rescale(entry, scale), 0n);

  return format(total, scale);
}

/**
 * 10 進小数を減算する。
 *
 * @param minuend 引かれる値
 * @param subtrahend 引く値
 * @returns 差の 10 進小数の文字列
 */
export function subtractDecimals(minuend: string, subtrahend: string): string {
  const negated = subtrahend.startsWith('-') ? subtrahend.slice(1) : `-${subtrahend}`;
  return addDecimals([minuend, negated]);
}

/**
 * 指定の小数桁数へ四捨五入する（ROUND_HALF_UP）。
 *
 * 負の値は絶対値に対して四捨五入するため、-1.005 は -1.01 になる。
 * 桁数が足りない場合はゼロ詰めして桁数を揃える。
 *
 * @param value 丸める 10 進小数の文字列
 * @param scale 丸めた後の小数桁数
 * @returns 丸めた 10 進小数の文字列
 */
export function roundHalfUp(value: string, scale: number): string {
  const parsed = parse(value);

  if (parsed.scale <= scale) {
    return format(rescale(parsed, scale), scale);
  }

  const isNegative = parsed.unscaled < 0n;
  const magnitude = isNegative ? -parsed.unscaled : parsed.unscaled;
  const divisor = 10n ** BigInt(parsed.scale - scale);
  const quotient = magnitude / divisor;
  const remainder = magnitude % divisor;
  const rounded = remainder * 2n >= divisor ? quotient + 1n : quotient;

  return format(isNegative ? -rounded : rounded, scale);
}

/**
 * 10 進小数を乗算する。結果の小数桁数は両者の桁数の和になる。
 *
 * 為替換算（原金額 × レート）に用いる。丸めは呼び出し側が roundHalfUp で行う。
 *
 * @param a 乗数
 * @param b 被乗数
 * @returns 積の 10 進小数の文字列
 */
export function multiplyDecimals(a: string, b: string): string {
  const left = parse(a);
  const right = parse(b);

  return format(left.unscaled * right.unscaled, left.scale + right.scale);
}

/**
 * 10 進小数を除算し、指定の小数桁数へ四捨五入する。
 *
 * 除算は割り切れないことがあるため、乗算と異なり結果の桁数を呼び出し側が指定する。
 * 月額の日割りなど、浮動小数点を経由すると誤差が入る計算に用いる。
 *
 * @param dividend 割られる値
 * @param divisor 割る値
 * @param scale 結果の小数桁数
 * @returns 商の 10 進小数の文字列
 * @throws {RangeError} 除数が 0 の場合
 */
export function divideDecimals(dividend: string, divisor: string, scale: number): string {
  const left = parse(dividend);
  const right = parse(divisor);

  if (right.unscaled === 0n) {
    throw new RangeError('0 で除算することはできません');
  }

  // 商を指定桁数より 1 桁多く求め、その桁を見て四捨五入する。
  const shift = BigInt(scale + 1 + right.scale - left.scale);
  const scaledDividend =
    shift >= 0n ? left.unscaled * 10n ** shift : left.unscaled / 10n ** -shift;

  const quotient = scaledDividend / right.unscaled;
  const isNegative = quotient < 0n;
  const magnitude = isNegative ? -quotient : quotient;

  const lastDigit = magnitude % 10n;
  const rounded = lastDigit >= 5n ? magnitude / 10n + 1n : magnitude / 10n;

  return format(isNegative ? -rounded : rounded, scale);
}
