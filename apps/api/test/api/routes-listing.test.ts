import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

/**
 * 取得可能な日付の一覧。
 *
 * 一覧の対象は、レコードが存在し、かつ最新リビジョンが刻印済みの日である。
 * 刻印が 1 件でもあることをもって刻印済みと見なすと、訂正リビジョンが未刻印の日を
 * 取得できると誤って示し、示すリビジョン番号も実際に返るものと食い違う。
 * 詳細は specs/paid-record-api/spec.md の「取得可能な日付の一覧」を参照。
 */

/** 対象日にレコードと刻印を置く。刻印のリビジョンを省くとレコードと同じにする。 */
async function seed(date: string, recordRevision: number, anchorRevision = recordRevision) {
  const pad = (revision: number) => String(revision).padStart(3, '0');

  for (let revision = 1; revision <= recordRevision; revision += 1) {
    await env.RECORDS.put(`records/${date}/${pad(revision)}.json`, '{}');
  }
  for (let revision = 1; revision <= anchorRevision; revision += 1) {
    await env.RECORDS.put(`anchors/${date}/${pad(revision)}.json`, '{}');
  }
}

/** 一覧を取得する。 */
async function listRecords(): Promise<{ date: string; revision: number }[]> {
  const response = await SELF.fetch('https://example.com/v1/records');
  const body = await response.json<{ records: { date: string; revision: number }[] }>();

  return body.records;
}

beforeEach(async () => {
  const listed = await env.RECORDS.list();
  await Promise.all(listed.objects.map((object) => env.RECORDS.delete(object.key)));
});

describe('GET /v1/records', () => {
  it('支払いなしで取得できる', async () => {
    await seed('2026-09-15', 1);

    const response = await SELF.fetch('https://example.com/v1/records');

    expect(response.status).toBe(200);
  });

  it('対象日とリビジョン番号のみが返り金額を含まない', async () => {
    await seed('2026-09-15', 2);

    expect(await listRecords()).toEqual([{ date: '2026-09-15', revision: 2 }]);
  });

  it('レコードはあるが未刻印の日は含まれない', async () => {
    await env.RECORDS.put('records/2026-09-16/001.json', '{}');

    expect(await listRecords()).toEqual([]);
  });

  it('訂正リビジョンが未刻印の日は含まれない', async () => {
    // レコードは rev 2 まであるが、刻印は rev 1 までしかない。
    await seed('2026-09-16', 2, 1);

    // 古い刻印済みのリビジョン番号で現れてはならない。
    expect(await listRecords()).toEqual([]);
  });

  it('訂正リビジョンが刻印されると再び現れる', async () => {
    await seed('2026-09-16', 2, 2);

    expect(await listRecords()).toEqual([{ date: '2026-09-16', revision: 2 }]);
  });

  it('一覧のリビジョン番号は取得したときに返るものと一致する', async () => {
    await seed('2026-09-14', 3);
    await seed('2026-09-15', 2, 1);
    await seed('2026-09-16', 1);

    const listed = await listRecords();

    // 一覧に出る日は、レコードの最新リビジョンと一致した番号で出る。
    expect(listed).toEqual([
      { date: '2026-09-16', revision: 1 },
      { date: '2026-09-14', revision: 3 },
    ]);
  });
});
