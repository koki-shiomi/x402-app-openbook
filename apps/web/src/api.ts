/**
 * 有料 API への要求。
 *
 * 画面が表示する財務データは、すべてここを通して取得する。保存物へ直接
 * アクセスする経路は設けない。利用者が API から得られるものと画面に映るものが
 * 一致していなければ、画面は API の内容を確かめる用をなさない。
 *
 * 画面は API と同一のオリジンで配るため、相対パスで要求する。
 * 詳細は specs/public-dashboard/spec.md の「取得元の限定」を参照。
 */

/** 取得可能な対象日 1 件。 */
export interface AvailableRecord {
  /** 対象日（YYYY-MM-DD 形式）。 */
  date: string;
  /** 取得できるリビジョン番号。 */
  revision: number;
}

/** 支払いの条件のうち、画面が用いる部分。 */
export interface PaymentTerms {
  /** 決済のネットワーク（CAIP-2 形式）。 */
  network: string;
  /** 価格（資産の最小単位の整数の文字列）。 */
  amount: string;
  /** 決済に用いる資産のアドレス。 */
  asset: string;
  /** 受取先のアドレス。 */
  payTo: string;
  /** 署名の有効期間（秒）。 */
  maxTimeoutSeconds: number;
  /** 署名に用いる EIP-712 のドメインなど。 */
  extra: Record<string, unknown>;
}

/** 402 応答から取り出した支払いの要求。 */
export interface PaymentRequired {
  /** 提示された支払いの条件。 */
  terms: PaymentTerms;
  /** 対象となる資源の情報。署名に添えて送り返す。 */
  resource: unknown;
}

/**
 * 取得可能な対象日の一覧を取得する。支払いは不要である。
 *
 * @param fetchImpl 取得に用いる関数
 * @returns 対象日の降順の一覧
 */
export async function fetchAvailableRecords(
  fetchImpl: typeof fetch,
): Promise<AvailableRecord[]> {
  const response = await fetchImpl('/v1/records');
  if (!response.ok) {
    throw new Error(`一覧を取得できませんでした（${response.status}）`);
  }

  const body = (await response.json()) as { records?: AvailableRecord[] };
  return body.records ?? [];
}

/**
 * 支払いなしで対象日を要求し、提示された支払いの条件を取り出す。
 *
 * 402 以外が返る場合は、支払いへ進む前に理由を示せるようにそのまま返す。
 *
 * @param fetchImpl 取得に用いる関数
 * @param date 対象日（YYYY-MM-DD 形式）
 * @returns 支払いの条件、または支払い以外の応答
 */
export async function requestPaymentTerms(
  fetchImpl: typeof fetch,
  date: string,
): Promise<{ kind: 'payment-required'; required: PaymentRequired } | { kind: 'other'; response: Response }> {
  const response = await fetchImpl(`/v1/records/${date}`);

  if (response.status !== 402) {
    return { kind: 'other', response };
  }

  const header = response.headers.get('PAYMENT-REQUIRED');
  if (header === null) {
    throw new Error('支払いの条件が応答に含まれていません');
  }

  const decoded = JSON.parse(atob(header)) as {
    accepts?: PaymentTerms[];
    resource?: unknown;
  };
  const terms = decoded.accepts?.[0];
  if (terms === undefined) {
    throw new Error('支払いの条件が空です');
  }

  return { kind: 'payment-required', required: { terms, resource: decoded.resource } };
}
