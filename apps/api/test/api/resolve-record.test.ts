import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { ARC_NETWORK } from '@openbook/shared';

import { resolveRecordAccess } from '../../src/api/resolve-record.js';
import { recordKey } from '../../src/storage.js';

beforeEach(async () => {
  const listed = await env.RECORDS.list();
  await Promise.all(listed.objects.map((object) => env.RECORDS.delete(object.key)));
});

describe('レコード取得の前段判定', () => {
  it('形式が不正な対象日は invalid になる', async () => {
    const result = await resolveRecordAccess(env.RECORDS, '2026/09/15');

    expect(result).toEqual({ kind: 'invalid' });
  });

  it('実在しない暦日も invalid になる', async () => {
    const result = await resolveRecordAccess(env.RECORDS, '2026-02-30');

    expect(result).toEqual({ kind: 'invalid' });
  });

  it('レコードのない日は not-found になる', async () => {
    const result = await resolveRecordAccess(env.RECORDS, '2026-09-15');

    expect(result).toEqual({ kind: 'not-found' });
  });

  it('レコードはあるが未刻印の日は unanchored になる', async () => {
    await env.RECORDS.put(recordKey('2026-09-15', 1), '{"date":"2026-09-15","revision":1}');

    const result = await resolveRecordAccess(env.RECORDS, '2026-09-15');

    expect(result).toEqual({ kind: 'unanchored', date: '2026-09-15' });
  });

  it('刻印済みの日は ready になり対象のリビジョンを含む', async () => {
    await env.RECORDS.put(recordKey('2026-09-15', 2), '{"date":"2026-09-15","revision":2}');
    await env.RECORDS.put('anchors/2026-09-15/002.json', JSON.stringify({
      chainId: 5042, contractAddress: ARC_NETWORK.anchorContract,
    }));

    const result = await resolveRecordAccess(env.RECORDS, '2026-09-15');

    expect(result).toEqual({ kind: 'ready', date: '2026-09-15', revision: 2 });
  });

  it('同じアドレスの旧ネットワークの刻印は ready にしない', async () => {
    await env.RECORDS.put(recordKey('2026-09-15', 1), '{}');
    await env.RECORDS.put('anchors/2026-09-15/001.json', JSON.stringify({
      chainId: 5042002, contractAddress: ARC_NETWORK.anchorContract,
    }));
    expect(await resolveRecordAccess(env.RECORDS, '2026-09-15')).toEqual({ kind: 'unanchored', date: '2026-09-15' });
  });

  it('最新リビジョンより古い刻印しかない日は unanchored になる', async () => {
    await env.RECORDS.put(recordKey('2026-09-15', 2), '{"date":"2026-09-15","revision":2}');
    await env.RECORDS.put('anchors/2026-09-15/001.json', '{}');

    const result = await resolveRecordAccess(env.RECORDS, '2026-09-15');

    expect(result).toEqual({ kind: 'unanchored', date: '2026-09-15' });
  });
});
