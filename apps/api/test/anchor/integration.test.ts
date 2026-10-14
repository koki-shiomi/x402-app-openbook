import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import worker from '../../src/index.js';
import { ANCHOR_TRIGGER } from '../../src/triggers.js';
import { readAnchorRuns } from '../../src/anchor/store.js';
import { recordKey } from '../../src/storage.js';

/** test/support/runtime.ts で与えたテスト用トークン。 */
const TOKEN = 'test-token';

beforeEach(async () => {
  const listed = await env.RECORDS.list();
  await Promise.all(listed.objects.map((object) => env.RECORDS.delete(object.key)));
});

describe('刻印の契機', () => {
  it('手動再実行の後に刻印が 1 回行われ、応答に結果が含まれる', async () => {
    const response = await SELF.fetch('https://example.com/admin/rerun', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ date: '2026-09-15' }),
    });

    expect(response.status).toBe(200);
    const body = await response.json<{ anchor: { ok: boolean; missingSecrets?: string[] } }>();

    // テスト環境では刻印の設定を与えていないため、刻印は行われず理由が残る。
    expect(body.anchor.ok).toBe(false);
    expect(body.anchor.missingSecrets).toEqual([
      'ARC_SIGNER_PRIVATE_KEY',
      'ARC_RPC_URL',
      'ARC_ANCHOR_CONTRACT',
    ]);

    expect(await readAnchorRuns(env.RECORDS)).toHaveLength(1);
  });

  it('刻印が行われなくても手動再実行は成功として終わる', async () => {
    await env.RECORDS.put(
      recordKey('2026-09-15', 1),
      JSON.stringify({ date: '2026-09-15', revision: 1 }),
    );

    const response = await SELF.fetch('https://example.com/admin/rerun', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ date: '2026-09-15' }),
    });

    expect(response.status).toBe(200);
    // 刻印に失敗しても、保存済みのレコードは変わらない。
    expect(await env.RECORDS.get(recordKey('2026-09-15', 1))).not.toBeNull();
  });

  it('刻印の定期実行で刻印が 1 回行われる', async () => {
    const controller = {
      cron: ANCHOR_TRIGGER,
      scheduledTime: new Date('2026-09-16T07:00:00Z').getTime(),
      noRetry() {},
    } as ScheduledController;

    await worker.scheduled(controller, env);

    expect(await readAnchorRuns(env.RECORDS)).toHaveLength(1);
  });
});
