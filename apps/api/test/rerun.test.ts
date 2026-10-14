import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { readRun } from '../src/runlog.js';
import { getRecord } from '../src/storage.js';

/** test/support/runtime.ts で与えたテスト用トークン。 */
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
  it('認証済み要求で指定日の収集が実行される', async () => {
    const response = await rerun('2026-09-07', TOKEN);

    expect(response.status).toBe(200);

    // テスト環境では認証情報を与えていないため、5 提供元すべてが失敗する。
    // 全ソース失敗時はレコードを作らないのが仕様であり、実行された事実は実行記録に残る。
    const run = await readRun(env.RECORDS, '2026-09-07');
    expect(run?.ok).toBe(false);
    expect(run?.sources.map((source) => source.id).sort()).toEqual([
      'admob',
      'claude',
      'cloudflare',
      'resend',
      'supabase',
    ]);
    expect(run?.sources.every((source) => !source.ok)).toBe(true);
    expect(await getRecord(env.RECORDS, '2026-09-07')).toBeNull();
  });

  it('認証情報が未設定の提供元は理由とともに実行記録に残る', async () => {
    await rerun('2026-09-07', TOKEN);

    const run = await readRun(env.RECORDS, '2026-09-07');
    const claude = run?.sources.find((source) => source.id === 'claude');

    expect(claude?.reason).toMatch(/CLAUDE_ADMIN_KEY/);
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

  it('任意の過去日を指定して受け付ける', async () => {
    const response = await rerun('2026-01-15', TOKEN);

    expect(response.status).toBe(200);
    expect(await readRun(env.RECORDS, '2026-01-15')).not.toBeNull();
  });

  it('日付の形式が不正な要求は拒否される', async () => {
    const response = await rerun('2026/09/07', TOKEN);

    expect(response.status).toBe(400);
  });
});
