import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { latestRevisionByPrefix } from '../src/r2-listing.js';

beforeEach(async () => {
  const listed = await env.RECORDS.list();
  await Promise.all(listed.objects.map((object) => env.RECORDS.delete(object.key)));
});

describe('接頭辞ごとの最大リビジョンの列挙', () => {
  it('複数の対象日と複数のリビジョンから最大値を求める', async () => {
    await env.RECORDS.put('anchors/2026-09-14/001.json', '{}');
    await env.RECORDS.put('anchors/2026-09-15/001.json', '{}');
    await env.RECORDS.put('anchors/2026-09-15/002.json', '{}');

    const latest = await latestRevisionByPrefix(env.RECORDS, 'anchors/');

    expect(Object.fromEntries(latest)).toEqual({ '2026-09-14': 1, '2026-09-15': 2 });
  });

  it('対象がなければ空を返す', async () => {
    const latest = await latestRevisionByPrefix(env.RECORDS, 'anchors/');

    expect(latest.size).toBe(0);
  });
});
