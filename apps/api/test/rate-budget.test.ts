import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CollectionSource } from '../src/batch.js';
import { RequestBudget } from '../src/budget.js';
import { buildRunOptions } from '../src/index.js';
import { readCollectionRuns } from '../src/runlog.js';
import { runCollection } from '../src/schedule.js';
import { getRecord } from '../src/storage.js';

/**
 * 為替レートの取得が 1 回の実行の予算の対象になることの確認。
 *
 * 予算の外に置かれた問い合わせは、上限を消費しながら記録にも見積もりにも
 * 現れない。残りの回数を実際より多く見積もることになり、上限に達する時期を
 * 読み違える。詳細は specs/daily-batch/spec.md の
 * 「実行の問い合わせ回数の予算がすべての外部への問い合わせを覆う」を参照。
 */

const NOW = '2026-09-20T06:00:00Z';
/** 前日。最初の定期実行が担当する。 */
const PREVIOUS_DAY = '2026-09-19';

/** Frankfurter の応答を返す取得関数を作る。 */
function stubRate() {
  return vi.fn(
    async () =>
      new Response(
        JSON.stringify({ amount: 1, base: 'USD', date: PREVIOUS_DAY, rates: { JPY: 155.05 } }),
        { status: 200 },
      ),
  ) as unknown as typeof fetch;
}

/** 外部へ問い合わせず、JPY 以外の費用を 1 件返す収集ソース。 */
const usdSource: CollectionSource = {
  id: 'stub',
  revisable: false,
  requestsPerCollection: 0,
  async collect() {
    return {
      costs: [
        {
          source: 'stub',
          category: 'plan' as const,
          acquisition: 'measured' as const,
          revisable: false,
          currency: 'USD' as const,
          amount: '1.000000',
        },
      ],
      revenues: [],
    };
  },
};

/** 前日だけを担当する定期実行。 */
const DUTY = { cron: '0 6 * * *', collectPreviousDay: true, slice: { from: 2, to: 2 } };

beforeEach(async () => {
  const listed = await env.RECORDS.list();
  await Promise.all(listed.objects.map((object) => env.RECORDS.delete(object.key)));
});

describe('収集ソース以外の問い合わせ', () => {
  it('為替レートの取得が予算を消費する', async () => {
    const budget = new RequestBudget(10);
    const options = buildRunOptions(NOW, { fetchImpl: budget.wrap(stubRate()) });

    const rate = await options.fetchRate(PREVIOUS_DAY);

    expect(rate?.rate).toBe('155.05');
    expect(budget.used).toBe(1);
  });

  it('為替レートの取得が実行記録の問い合わせ回数に含まれる', async () => {
    const budget = new RequestBudget(10);
    const options = {
      ...buildRunOptions(NOW, { fetchImpl: budget.wrap(stubRate()) }),
      budget,
    };

    await runCollection(env.RECORDS, [usdSource], options, DUTY);

    const [run] = await readCollectionRuns(env.RECORDS);
    expect(run?.requestsUsed).toBe(1);
  });
});

describe('予算に達した状態での問い合わせ', () => {
  it('資源制約による中断として扱われ、レコードが作られない', async () => {
    // 予算を 0 件にして、最初の問い合わせで使い切っている状態を作る。
    const budget = new RequestBudget(0);
    const options = {
      ...buildRunOptions(NOW, { fetchImpl: budget.wrap(stubRate()) }),
      budget,
    };

    await runCollection(env.RECORDS, [usdSource], options, DUTY);

    expect(await getRecord(env.RECORDS, PREVIOUS_DAY, 1)).toBeNull();
  });

  it('提供元の欠測として記録されない', async () => {
    const budget = new RequestBudget(0);
    const options = {
      ...buildRunOptions(NOW, { fetchImpl: budget.wrap(stubRate()) }),
      budget,
    };

    await runCollection(env.RECORDS, [usdSource], options, DUTY);

    const [run] = await readCollectionRuns(env.RECORDS);
    // 中断した事実は実行記録に残り、レコードの incomplete には現れない。
    expect(run?.interrupted?.[0]?.date).toBe(PREVIOUS_DAY);
    expect(await getRecord(env.RECORDS, PREVIOUS_DAY, 1)).toBeNull();
  });
});
