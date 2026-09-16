import { compareDecimals, isDecimalString } from '@openbook/shared';

/**
 * x402 による決済の設定の読み取り。
 *
 * 秘匿不要な値もシークレットに寄せて設定箇所を 1 つにする（②の決定 6 と同じ）。
 * いずれかが欠けている場合、有料のエンドポイントは支払いを求められない状態になるため、
 * レコードを無料で配らないよう利用できないものとして扱う。
 * 詳細は specs/x402-payment/spec.md を参照。
 */

/** 決済に必要なシークレットの名前。 */
const REQUIRED = ['X402_FACILITATOR_URL', 'X402_PAY_TO', 'X402_PRICE_USDC'] as const;

/** シークレットとして与えられる値。 */
export type PaymentConfigInput = Partial<Record<(typeof REQUIRED)[number], string>>;

/** 決済に用いる設定。 */
export interface PaymentConfig {
  /** facilitator の所在。 */
  facilitatorUrl: string;
  /** 支払いの受取先アドレス。 */
  payTo: string;
  /** 1 日分の価格（USDC、10 進小数の文字列）。 */
  priceUsdc: string;
}

/** 設定の解決結果。 */
export interface PaymentConfigResult {
  /** すべてそろい、値が妥当な場合の設定。 */
  config?: PaymentConfig;
  /** 未設定のシークレットの名前。 */
  missing: string[];
  /** 値が妥当でない場合の理由。 */
  invalid?: string;
}

/**
 * 決済の設定を読み取る。
 *
 * 価格は 10 進小数の文字列として妥当で、かつ正の値でなければならない。
 * 0 や負の値を許すと、支払いを求めない、または成立しえない条件を提示することになる。
 *
 * @param input シークレットとして与えられた値
 * @returns 設定、未設定の項目名、または値が妥当でない理由
 */
export function loadPaymentConfig(input: PaymentConfigInput): PaymentConfigResult {
  const missing = REQUIRED.filter((name) => (input[name] ?? '') === '');
  if (missing.length > 0) {
    return { missing: [...missing] };
  }

  const priceUsdc = input.X402_PRICE_USDC!;
  if (!isDecimalString(priceUsdc) || compareDecimals(priceUsdc, '0') <= 0) {
    return {
      missing: [],
      invalid: `X402_PRICE_USDC は正の 10 進小数である必要があります: ${priceUsdc}`,
    };
  }

  return {
    config: {
      facilitatorUrl: input.X402_FACILITATOR_URL!,
      payTo: input.X402_PAY_TO!,
      priceUsdc,
    },
    missing: [],
  };
}
