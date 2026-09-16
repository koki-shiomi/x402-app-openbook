import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { ANCHOR_BATCH_LIMIT, listAnchorTargets } from '../../src/anchor/targets.js';
import { anchorKey } from '../../src/anchor/store.js';
import { recordKey } from '../../src/storage.js';

beforeEach(async () => {
  const listed = await env.RECORDS.list();
  await Promise.all(listed.objects.map((object) => env.RECORDS.delete(object.key)));
});

/** 指定した日とリビジョンのレコードを置く。内容は対象の算出に関わらない。 */
async function putRecordAt(date: string, revision: number): Promise<void> {
  await env.RECORDS.put(recordKey(date, revision), JSON.stringify({ date, revision }));
}

/** 指定した日とリビジョンを刻印済みにする。 */
async function putAnchorAt(date: string, revision: number): Promise<void> {
  await env.RECORDS.put(anchorKey(date, revision), JSON.stringify({ date, revision }));
}

describe('刻印の対象', () => {
  it('新しく保存されたレコードが対象になる', async () => {
    await putRecordAt('2026-09-14', 1);

    expect((await listAnchorTargets(env.RECORDS)).targets).toEqual([
      { date: '2026-09-14', revision: 1 },
    ]);
  });

  it('訂正リビジョンが追加された日が対象になる', async () => {
    await putRecordAt('2026-09-13', 1);
    await putAnchorAt('2026-09-13', 1);
    await putRecordAt('2026-09-13', 2);

    expect((await listAnchorTargets(env.RECORDS)).targets).toEqual([
      { date: '2026-09-13', revision: 2 },
    ]);
  });

  it('刻印までに複数回訂正された日は最新リビジョンだけが対象になる', async () => {
    await putRecordAt('2026-09-13', 1);
    await putAnchorAt('2026-09-13', 1);
    await putRecordAt('2026-09-13', 2);
    await putRecordAt('2026-09-13', 3);

    expect((await listAnchorTargets(env.RECORDS)).targets).toEqual([
      { date: '2026-09-13', revision: 3 },
    ]);
  });

  it('刻印済みで訂正のない日は対象にならない', async () => {
    await putRecordAt('2026-09-13', 1);
    await putAnchorAt('2026-09-13', 1);

    expect((await listAnchorTargets(env.RECORDS)).targets).toEqual([]);
  });

  it('対象がない場合は空を返す', async () => {
    expect((await listAnchorTargets(env.RECORDS)).targets).toEqual([]);
  });

  it('上限を超える場合は対象日の新しい順に上限までを返す', async () => {
    const dates = Array.from(
      { length: ANCHOR_BATCH_LIMIT + 3 },
      (_unused, index) => `2026-07-${String(index + 1).padStart(2, '0')}`,
    );
    for (const date of dates) {
      await putRecordAt(date, 1);
    }

    const { targets, deferred } = await listAnchorTargets(env.RECORDS);

    expect(targets).toHaveLength(ANCHOR_BATCH_LIMIT);
    expect(targets[0]?.date).toBe(dates.at(-1));
    expect(targets.at(-1)?.date).toBe(dates.at(-ANCHOR_BATCH_LIMIT)!);

    // 上限を超えた分は次の実行へ回す。
    expect(deferred.map((item) => item.date)).toEqual([dates[2], dates[1], dates[0]]);
  });

  it('遡及の対象期間に関わらず、未刻印の古い日も対象になる', async () => {
    await putRecordAt('2026-01-05', 1);
    await putRecordAt('2026-09-14', 1);

    expect((await listAnchorTargets(env.RECORDS)).targets).toEqual([
      { date: '2026-09-14', revision: 1 },
      { date: '2026-01-05', revision: 1 },
    ]);
  });
});
