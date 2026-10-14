import { canonicalize } from '@openbook/shared';

import { listKeys } from '../r2-listing.js';

/**
 * 支払いの明細の保存。
 *
 * メインネットの実際の USDC 決済を明細として保存する。既存の財務収集とは独立し、
 * この変更では日次レコードへの収益集計を追加しない。
 * 詳細は specs/x402-payment/spec.md を参照。
 */

/** 支払い 1 件の明細。 */
export interface PaymentReceipt {
  /** 決済が成立した時刻（RFC 3339）。 */
  settledAt: string;
  /** 支払いの対象となった日次レコードの対象日（YYYY-MM-DD 形式）。 */
  date: string;
  /** 支払われた金額（資産の最小単位の整数）。 */
  amount: string;
  /** 支払いに用いられた資産のアドレス。 */
  asset: string;
  /** 決済が行われたネットワーク（CAIP-2）。 */
  network: string;
  /** 支払い元のアドレス。 */
  payer: string;
  /** 決済のトランザクションのハッシュ。 */
  transactionHash: string;
}

/**
 * 支払いの明細のキーを対象日と成立時刻から導出する。
 *
 * 対象日ごとに引けるようにし、同じ日への複数回の支払いが上書きされないよう
 * 時刻をキーに含める。
 *
 * @param date 対象日（YYYY-MM-DD 形式）
 * @param settledAt 成立時刻（RFC 3339）
 * @returns R2 のオブジェクトキー
 */
export function paymentReceiptKey(date: string, settledAt: string): string {
  return `payments/${date}/${settledAt.replaceAll(':', '-').replaceAll('.', '-')}.json`;
}

/**
 * 支払いの明細を保存する。
 *
 * @param bucket 保存先の R2 バケット
 * @param receipt 保存する明細
 */
export async function writePaymentReceipt(
  bucket: R2Bucket,
  receipt: PaymentReceipt,
): Promise<void> {
  await bucket.put(paymentReceiptKey(receipt.date, receipt.settledAt), canonicalize(receipt));
}

/**
 * 対象日の支払いの明細を、成立の古い順に読み出す。
 *
 * @param bucket 取得元の R2 バケット
 * @param date 対象日（YYYY-MM-DD 形式）
 * @returns 明細の配列
 */
export async function listPaymentReceipts(
  bucket: R2Bucket,
  date: string,
): Promise<PaymentReceipt[]> {
  const keys = (await listKeys(bucket, `payments/${date}/`)).sort();

  const receipts: PaymentReceipt[] = [];
  for (const key of keys) {
    const object = await bucket.get(key);
    if (object !== null) {
      receipts.push((await object.json()) as PaymentReceipt);
    }
  }

  return receipts;
}
