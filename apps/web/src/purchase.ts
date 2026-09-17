import { requestPaymentTerms } from './api.js';
import { buildAuthorization, signPayment, toPaymentHeader } from './payment.js';
import {
  checkPreconditions,
  type EthereumProvider,
  type PreconditionFailure,
} from './preconditions.js';

/**
 * 1 日分の購入。
 *
 * 支払いなしで要求して条件を受け取り、事前条件を確かめてから署名し、支払いを
 * 添えて再要求する。取得したバイト列は呼び出し元へ返すだけで、保存しない。
 * 詳細は specs/public-dashboard/spec.md の「ウォレットによる支払い」を参照。
 */

/** 応答ヘッダが示す刻印の情報。検証の根拠には用いず、画面の照会結果と並べて示す。 */
export interface AnchorHeaders {
  revision: number;
  hash: string;
  chainId: number;
  contract: string;
  transaction?: string;
  block?: number;
}

/** 購入の依存。テストから差し替える。 */
export interface PurchaseDeps {
  /** 取得に用いる関数。 */
  fetchImpl: typeof fetch;
  /** ウォレットのプロバイダ。 */
  ethereum: EthereumProvider;
  /** 決済の取次へ預け入れた残高を読む。 */
  readDeposit: (asset: string, account: string) => Promise<bigint>;
}

/** 購入の結果。 */
export type PurchaseResult =
  | { ok: true; bytes: Uint8Array; anchorHeaders: AnchorHeaders }
  | {
      ok: false;
      reason: PreconditionFailure | 'not-purchasable' | 'settlement-failed';
      message: string;
      details?: Record<string, unknown>;
    };

/**
 * 対象日を 1 日分購入する。
 *
 * @param date 対象日（YYYY-MM-DD 形式）
 * @param deps 依存
 * @returns 取得したバイト列、または購入できない理由
 */
export async function purchase(date: string, deps: PurchaseDeps): Promise<PurchaseResult> {
  const requested = await requestPaymentTerms(deps.fetchImpl, date);

  if (requested.kind === 'other') {
    // 400・404・409 は支払いを求める前に返る。理由をそのまま伝える。
    const body = (await requested.response.json().catch(() => ({}))) as {
      reason?: string;
      error?: string;
    };

    return {
      ok: false,
      reason: 'not-purchasable',
      message: body.reason ?? body.error ?? `取得できません（${requested.response.status}）`,
    };
  }

  const { terms, resource } = requested.required;

  const precondition = await checkPreconditions(terms, {
    ethereum: deps.ethereum,
    readDeposit: deps.readDeposit,
  });

  if (!precondition.ok) {
    return {
      ok: false,
      reason: precondition.reason,
      message: precondition.message,
      ...(precondition.details === undefined ? {} : { details: precondition.details }),
    };
  }

  const built = buildAuthorization(terms, precondition.address);
  const signature = await signPayment(deps.ethereum, built);

  const paid = await deps.fetchImpl(`/v1/records/${date}`, {
    headers: { 'PAYMENT-SIGNATURE': toPaymentHeader(terms, resource, built, signature) },
  });

  if (!paid.ok) {
    return {
      ok: false,
      reason: 'settlement-failed',
      message: settlementMessage(paid),
    };
  }

  return {
    ok: true,
    bytes: new Uint8Array(await paid.arrayBuffer()),
    anchorHeaders: readAnchorHeaders(paid.headers),
  };
}

/**
 * 決済が成立しなかった理由を読み取る。
 *
 * @param response 支払いを添えた要求への応答
 * @returns 利用者へ示す文言
 */
function settlementMessage(response: Response): string {
  const header = response.headers.get('PAYMENT-RESPONSE');
  if (header !== null) {
    try {
      const settlement = JSON.parse(atob(header)) as { errorReason?: string };
      if (settlement.errorReason !== undefined) {
        return `決済が成立しませんでした（${settlement.errorReason}）`;
      }
    } catch {
      // 読み取れない場合は状態番号のみを示す。
    }
  }

  return `決済が成立しませんでした（${response.status}）`;
}

/**
 * 応答ヘッダから刻印の情報を読み取る。
 *
 * この値は検証の根拠には用いない。画面が独自に照会した結果と並べて示すためだけに
 * 取り出す。詳細は design.md の決定 5 を参照。
 *
 * @param headers 応答ヘッダ
 * @returns 刻印の情報
 */
function readAnchorHeaders(headers: Headers): AnchorHeaders {
  const transaction = headers.get('X-Anchor-Transaction');
  const block = headers.get('X-Anchor-Block');

  return {
    revision: Number(headers.get('X-Anchor-Revision')),
    hash: headers.get('X-Anchor-Hash') ?? '',
    chainId: Number(headers.get('X-Anchor-Chain-Id')),
    contract: headers.get('X-Anchor-Contract') ?? '',
    ...(transaction === null ? {} : { transaction }),
    ...(block === null ? {} : { block: Number(block) }),
  };
}
