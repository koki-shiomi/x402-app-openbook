import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { listAvailableRecords } from '../../src/api/listing.js';
import { recordKey } from '../../src/storage.js';

beforeEach(async () => {
  const listed = await env.RECORDS.list();
  await Promise.all(listed.objects.map((object) => env.RECORDS.delete(object.key)));
});

/**
 * 対象日を刻印済みにする（レコードの内容は問わない）。
 *
 * 一覧はレコードと刻印の最新リビジョンの一致で判定するため、刻印だけでなく
 * 対応するレコードも置く。刻印だけがある状態は本番では生じない。
 */
async function putAnchored(date: string, revision: number): Promise<void> {
  const name = `${String(revision).padStart(3, '0')}.json`;
  await env.RECORDS.put(`records/${date}/${name}`, '{}');
  await env.RECORDS.put(`anchors/${date}/${name}`, '{}');
}

describe('取得可能な日付の一覧', () => {
  it('刻印済みの日が対象日の降順で返る', async () => {
    await putAnchored('2026-09-13', 1);
    await putAnchored('2026-09-15', 1);
    await putAnchored('2026-09-14', 2);

    expect(await listAvailableRecords(env.RECORDS)).toEqual([
      { date: '2026-09-15', revision: 1 },
      { date: '2026-09-14', revision: 2 },
      { date: '2026-09-13', revision: 1 },
    ]);
  });

  it('刻印のない日は含まれない', async () => {
    await putAnchored('2026-09-13', 1);
    await env.RECORDS.put(recordKey('2026-09-14', 1), '{}');

    expect(await listAvailableRecords(env.RECORDS)).toEqual([
      { date: '2026-09-13', revision: 1 },
    ]);
  });

  it('刻印が 1 件もなければ空が返る', async () => {
    expect(await listAvailableRecords(env.RECORDS)).toEqual([]);
  });

  it('金額を含まない', async () => {
    await putAnchored('2026-09-13', 1);

    const result = await listAvailableRecords(env.RECORDS);

    expect(Object.keys(result[0]!)).toEqual(['date', 'revision']);
  });
});
