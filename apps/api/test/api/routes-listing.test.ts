import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

beforeEach(async () => {
  const listed = await env.RECORDS.list();
  await Promise.all(listed.objects.map((object) => object.key.startsWith('anchors/') && env.RECORDS.delete(object.key)));
});

describe('GET /v1/records', () => {
  it('支払いなしで取得できる', async () => {
    await env.RECORDS.put('anchors/2026-09-15/001.json', '{}');

    const response = await SELF.fetch('https://example.com/v1/records');

    expect(response.status).toBe(200);
  });

  it('対象日とリビジョン番号のみが返り金額を含まない', async () => {
    await env.RECORDS.put('anchors/2026-09-15/002.json', '{}');

    const response = await SELF.fetch('https://example.com/v1/records');
    const body = await response.json<{ records: { date: string; revision: number }[] }>();

    expect(body.records).toEqual([{ date: '2026-09-15', revision: 2 }]);
  });

  it('レコードはあるが未刻印の日は含まれない', async () => {
    await env.RECORDS.put('records/2026-09-16/001.json', '{}');

    const response = await SELF.fetch('https://example.com/v1/records');
    const body = await response.json<{ records: unknown[] }>();

    expect(body.records).toEqual([]);
  });
});
