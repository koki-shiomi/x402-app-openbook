import type { OffsetRange } from './schedule.js';

/**
 * 定期実行の担当範囲。
 *
 * 1 回の実行で使える外部への問い合わせ回数には上限があるため、1 日分の収集を
 * 複数の定期実行へ分けて担当させる。刻印はさらに別の定期実行で行う。
 * 詳細は specs/daily-batch/spec.md の「日次の定期実行」と design.md の決定 1 を参照。
 */

/** 収集を担当する定期実行 1 本。 */
export interface CollectionTrigger {
  /** 設定ファイルに書く定期実行の指定。 */
  cron: string;
  /** 前日の収集を担当するか。 */
  collectPreviousDay: boolean;
  /** 担当する再収集の対象日の区間。 */
  slice: OffsetRange;
}

/**
 * 収集を担当する定期実行。
 *
 * 担当日数を均等にしないのは、対象日ごとの問い合わせ回数が区間で変わるためである。
 * 2〜29 日前は Resend が遡及できるため 1 日あたり 3 件、30 日前より古い日は
 * Claude と AdMob のみで 2 件になる。加えて最初の実行は前日の収集と為替レートの
 * 取得を担う。均等に分けると最初の実行が予算を超える。
 */
export const COLLECTION_TRIGGERS: readonly CollectionTrigger[] = [
  { cron: '0 6 * * *', collectPreviousDay: true, slice: { from: 2, to: 12 } },
  { cron: '20 6 * * *', collectPreviousDay: false, slice: { from: 13, to: 25 } },
  { cron: '40 6 * * *', collectPreviousDay: false, slice: { from: 26, to: 40 } },
];

/**
 * 刻印を担当する定期実行。
 *
 * その日の収集を担当するすべての定期実行より後に置く。収集と同じ実行で刻印すると、
 * 収集が使い切った問い合わせ回数の残りで刻印することになる。
 */
export const ANCHOR_TRIGGER = '0 7 * * *';

/**
 * 1 回の実行で使える問い合わせ回数の予算。
 *
 * 実行環境の上限は 50 件である。宣言した回数はあくまで見積もりであり、提供元の
 * 応答によっては増えうるため、上限そのものではなく余裕を残した値を予算とする。
 */
export const REQUEST_BUDGET = 45;

/**
 * 起動した定期実行の指定から、収集の担当を引く。
 *
 * @param cron 起動した定期実行の指定
 * @returns 該当する担当。収集の定期実行でなければ undefined
 */
export function findCollectionTrigger(cron: string): CollectionTrigger | undefined {
  return COLLECTION_TRIGGERS.find((trigger) => trigger.cron === cron);
}
