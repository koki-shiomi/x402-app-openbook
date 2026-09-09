import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { closeMonth, getRecord } from '../src/storage.js';

/** wrangler.jsonc の vars で与えたテスト用トークン。 */
const TOKEN = 'test-token';

beforeEach(async () => {
  const listed = await env.RECORDS.list();
  await Promise.all(listed.objects.map((object) => env.RECORDS.delete(object.key)));
});

/** 手動再実行を要求する。 */
function rerun(date: string, token?: string): Promise<Response> {
  return SELF.fetch('https://example.com/admin/rerun', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify({ date }),
  });
}

describe('手動再実行', () => {
  it('認証済み要求でクローズされていない月の指定日の収集が実行される', async () => {
    const response = await rerun('2026-09-07', TOKEN);

    expect(response.status).toBe(200);
    expect(await getRecord(env.RECORDS, '2026-09-07')).not.toBeNull();
  });

  it('認証情報のない要求は拒否され、収集は実行されない', async () => {
    const response = await rerun('2026-09-07');

    expect(response.status).toBe(401);
    expect(await getRecord(env.RECORDS, '2026-09-07')).toBeNull();
  });

  it('誤ったトークンの要求は拒否される', async () => {
    const response = await rerun('2026-09-07', 'wrong-token');

    expect(response.status).toBe(401);
    expect(await getRecord(env.RECORDS, '2026-09-07')).toBeNull();
  });

  it('認証済みでもクローズ済み月は拒否される', async () => {
    await closeMonth(env.RECORDS, '2026-09', { closedAt: '2026-10-06T07:00:00Z' });

    const response = await rerun('2026-09-07', TOKEN);

    expect(response.status).toBe(409);
    expect(await getRecord(env.RECORDS, '2026-09-07')).toBeNull();
  });

  it('日付の形式が不正な要求は拒否される', async () => {
    const response = await rerun('2026/09/07', TOKEN);

    expect(response.status).toBe(400);
  });
});
