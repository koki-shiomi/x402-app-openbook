import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { sha256Hex } from '@openbook/shared';

import { putAnchorRecord } from '../../src/anchor/store.js';
import { recordKey } from '../../src/storage.js';

beforeEach(async () => {
  const listed = await env.RECORDS.list();
  await Promise.all(listed.objects.map((object) => env.RECORDS.delete(object.key)));
});

/** 刻印済みのレコードを 1 件用意する。 */
async function seedAnchoredRecord(date: string, revision: number): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(`{"date":"${date}","revision":${revision}}`);
  await env.RECORDS.put(recordKey(date, revision), bytes);
  await putAnchorRecord(env.RECORDS, {
    date,
    revision,
    hash: await sha256Hex(bytes),
    chainId: 5042,
    contractAddress: '0xC039722204Dde6DF3dFb48a9a3068163d30b997a',
    transactionHash: '0xabc',
    blockNumber: 100,
    recordedAt: '2026-09-16T00:00:00.000Z',
  });
  return bytes;
}

describe('GET /v1/records/:date', () => {
  it('削除後は一覧が空で、旧対象日には課金を要求しない', async () => {
    await seedAnchoredRecord('2026-09-15', 1);
    const objects = await env.RECORDS.list();
    await Promise.all(objects.objects.map(object => env.RECORDS.delete(object.key)));
    const listing = await SELF.fetch('https://example.com/v1/records');
    expect(await listing.json()).toEqual({ records: [] });
    const response = await SELF.fetch('https://example.com/v1/records/2026-09-15');
    expect(response.status).toBe(404);
    expect(response.headers.has('PAYMENT-REQUIRED')).toBe(false);
  });
  it('刻印済みの日は支払いが求められ、本文は返らない', async () => {
    await seedAnchoredRecord('2026-09-15', 1);

    const response = await SELF.fetch('https://example.com/v1/records/2026-09-15');

    // テスト環境では決済の設定を与えていないため、503 で本文を返さない。
    // 決済の設定がある場合の 402 と成立後の 200 は test/payment/paid-record.test.ts で確認する。
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('"revision"');
  });

  it('最新リビジョン以外を指定する手段がない', async () => {
    await seedAnchoredRecord('2026-09-15', 1);

    const response = await SELF.fetch('https://example.com/v1/records/2026-09-15/1');

    // リビジョンを含むパスは、そもそもルートとして存在しない。
    expect(response.status).toBe(404);
  });

  it('形式が不正な対象日は 400', async () => {
    const response = await SELF.fetch('https://example.com/v1/records/2026-09-15T00:00:00Z');

    expect(response.status).toBe(400);
  });

  it('レコードのない日は 404', async () => {
    const response = await SELF.fetch('https://example.com/v1/records/2026-09-15');

    expect(response.status).toBe(404);
  });

  it('レコードはあるが未刻印の日は 409 で刻印待ちと対象日が分かる', async () => {
    await env.RECORDS.put(recordKey('2026-09-15', 1), '{"date":"2026-09-15","revision":1}');

    const response = await SELF.fetch('https://example.com/v1/records/2026-09-15');
    const body = await response.json<{ date: string; reason: string }>();

    expect(response.status).toBe(409);
    expect(body.date).toBe('2026-09-15');
    expect(body.reason).toMatch(/刻印/);
  });

  it('前段の判定は決済の設定より先に働く', async () => {
    // 決済の設定がなくても、存在しない日は 503 ではなく 404 になる。
    const response = await SELF.fetch('https://example.com/v1/records/2026-01-01');

    expect(response.status).toBe(404);
  });
});
