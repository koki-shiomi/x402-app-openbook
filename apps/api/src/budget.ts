/**
 * 1 回の実行で使える外部への問い合わせ回数の管理。
 *
 * 実行環境は 1 回の実行あたりの問い合わせ回数に上限を設けており、上限に達すると
 * 以降の問い合わせが実行環境の都合で失敗する。この失敗は提供元からの取得失敗と
 * 区別がつかない形で現れるため、上限に達する前に処理を止める。
 * 詳細は specs/daily-batch/spec.md の「実行環境の制約による失敗と提供元の欠測の区別」を参照。
 */

/** 予算を使い切ったために問い合わせを行えないこと。 */
export class RequestBudgetExceededError extends Error {
  constructor(limit: number) {
    super(`1 回の実行で使える問い合わせ回数の予算 ${limit} 件を使い切りました`);
    this.name = 'RequestBudgetExceededError';
  }
}

/**
 * ある失敗が実行環境の資源制約によるものかを判定する。
 *
 * 予算による打ち切りのほか、実行環境が直接返す上限超過も資源制約として扱う。
 * 提供元からの取得失敗とは区別して扱う必要があるためである。
 *
 * @param error 判定する失敗
 * @returns 資源制約による失敗であれば true
 */
export function isResourceLimitError(error: unknown): boolean {
  if (error instanceof RequestBudgetExceededError) {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error);
  return message.includes('Too many subrequests');
}

/** 1 回の実行で使える問い合わせ回数の予算。 */
export class RequestBudget {
  /** 予算の総量。 */
  readonly limit: number;

  /** 使用済みの回数。 */
  #used = 0;

  /**
   * @param limit 1 回の実行で使える問い合わせ回数
   */
  constructor(limit: number) {
    this.limit = limit;
  }

  /** 使用済みの回数。 */
  get used(): number {
    return this.#used;
  }

  /** 残りの回数。 */
  get remaining(): number {
    return this.limit - this.#used;
  }

  /**
   * 指定した回数の問い合わせを行う余地があるかを返す。
   *
   * @param count 行おうとしている問い合わせの回数
   * @returns 余地があれば true
   */
  canAfford(count: number): boolean {
    return this.remaining >= count;
  }

  /**
   * 問い合わせ回数を数える `fetch` を返す。
   *
   * 予算を使い切っている場合は問い合わせを行わず、資源制約の失敗を投げる。
   *
   * @param fetchImpl 包む対象の取得関数
   * @returns 回数を数える取得関数
   */
  wrap(fetchImpl: typeof fetch): typeof fetch {
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (this.remaining <= 0) {
        throw new RequestBudgetExceededError(this.limit);
      }

      this.#used += 1;
      return await fetchImpl(input as RequestInfo, init);
    }) as unknown as typeof fetch;
  }
}
