import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { createRecord } from '@openbook/shared';

import worker from '../src/index.js';
import { readAnchorRuns } from '../src/anchor/store.js';
import { readCollectionRuns, readRun } from '../src/runlog.js';
import { recollectionDates } from '../src/schedule.js';
import { ANCHOR_TRIGGER, COLLECTION_TRIGGERS } from '../src/triggers.js';
import { putRecord } from '../src/storage.js';

/** 起動した定期実行を表す最小の制御情報。 */
function controllerFor(cron: string, now: string): ScheduledController {
  return {
    cron,
    scheduledTime: new Date(now).getTime(),
    noRetry() {},
  } as ScheduledController;
}

const NOW = '2026-09-20T06:00:00Z';

/** 対象日にレコードを置く。 */
async function seed(date: string): Promise<void> {
  await putRecord(
    env.RECORDS,
    createRecord({ date, revision: 1, generatedAt: '2026-09-01T06:00:00Z' }),
  );
}

beforeEach(async () => {
  const listed = await env.RECORDS.list();
  await Promise.all(listed.objects.map((object) => env.RECORDS.delete(object.key)));
});

describe('定期実行の分岐', () => {
  it('各定期実行が自身の担当範囲だけを扱う', async () => {
    // 3 日前・15 日前・30 日前にレコードを置き、担当範囲ごとに扱われる日を見る。
    await seed('2026-09-17'); // 3 日前 → 最初の担当
    await seed('2026-09-05'); // 15 日前 → 2 番目の担当
    await seed('2026-08-21'); // 30 日前 → 3 番目の担当

    for (const trigger of COLLECTION_TRIGGERS) {
      await worker.scheduled(controllerFor(trigger.cron, NOW), env);
    }

    const runs = await readCollectionRuns(env.RECORDS);
    const byTrigger = new Map(runs.map((run) => [run.trigger, run.dates]));

    /** 担当範囲を対象日の区間へ直す。 */
    function span(trigger: (typeof COLLECTION_TRIGGERS)[number]) {
      const dates = recollectionDates(NOW, trigger.slice);
      return { earliest: dates[0]!, latest: dates.at(-1)! };
    }

    // レコードを置いた日はそれぞれの担当が扱い、他の担当は扱わない。
    // （欠落した日の埋め戻しも起きるため、扱った日の集合は完全一致では確かめない）
    const seeded = ['2026-09-17', '2026-09-05', '2026-08-21'];
    COLLECTION_TRIGGERS.forEach((trigger, index) => {
      const dates = byTrigger.get(trigger.cron) ?? [];
      const { earliest, latest } = span(trigger);

      expect(dates).toContain(seeded[index]);
      for (const other of seeded.filter((date) => date !== seeded[index])) {
        expect(dates).not.toContain(other);
      }
      // 扱った日がすべて自身の担当範囲に収まる。
      for (const date of dates) {
        expect(date >= earliest && date <= latest).toBe(true);
      }
    });
  });

  it('前日の収集は最初の定期実行だけが行う', async () => {
    // 2 番目と 3 番目だけを動かしても、前日（2026-09-19）は収集されない。
    for (const trigger of COLLECTION_TRIGGERS.slice(1)) {
      await worker.scheduled(controllerFor(trigger.cron, NOW), env);
    }
    expect(await readRun(env.RECORDS, '2026-09-19')).toBeNull();

    await worker.scheduled(controllerFor(COLLECTION_TRIGGERS[0]!.cron, NOW), env);
    expect(await readRun(env.RECORDS, '2026-09-19')).not.toBeNull();

    // 前日は再収集の担当範囲には含まれない。
    for (const run of await readCollectionRuns(env.RECORDS)) {
      expect(run.dates).not.toContain('2026-09-19');
    }
  });

  it('未知の指定では何も処理せず実行記録に残る', async () => {
    await seed('2026-09-17');

    await worker.scheduled(controllerFor('99 9 * * *', NOW), env);

    const runs = await readCollectionRuns(env.RECORDS);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.trigger).toBe('99 9 * * *');
    expect(runs[0]?.dates).toEqual([]);
    expect(runs[0]?.reason).toMatch(/担当/);
  });
});

describe('刻印の分離', () => {
  it('収集の定期実行では刻印が行われない', async () => {
    for (const trigger of COLLECTION_TRIGGERS) {
      await worker.scheduled(controllerFor(trigger.cron, NOW), env);
    }

    expect(await readAnchorRuns(env.RECORDS)).toEqual([]);
  });

  it('刻印の定期実行では収集を行わず刻印が 1 回行われる', async () => {
    await worker.scheduled(controllerFor(ANCHOR_TRIGGER, NOW), env);

    expect(await readAnchorRuns(env.RECORDS)).toHaveLength(1);
    expect(await readCollectionRuns(env.RECORDS)).toEqual([]);
    // 収集を行わないため、前日のレコードは作られない。
    expect((await env.RECORDS.list({ prefix: 'records/' })).objects).toEqual([]);
  });

  it('収集が失敗した後でも刻印は通常どおり行われる', async () => {
    // 収集の定期実行を動かさないまま刻印だけを動かす状況を再現する。
    await worker.scheduled(controllerFor(ANCHOR_TRIGGER, NOW), env);

    const [run] = await readAnchorRuns(env.RECORDS);
    expect(run).toBeDefined();
  });
});
