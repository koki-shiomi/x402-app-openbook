import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { createRecord, canonicalize, type DailyRecord } from '@openbook/shared';

import {
  getRecord,
  listRecords,
  putRaw,
  putRecord,
  rawKey,
  recordKey,
} from '../src/storage.js';

const decoder = new TextDecoder();

/** テスト用のレコードを作る。 */
function record(date: string, revision = 1, amount = '12.00'): DailyRecord {
  return createRecord({
    date,
    revision,
    generatedAt: '2026-09-08T06:00:00Z',
    revenues: [
      {
        source: 'admob',
        category: 'estimated-earnings',
        acquisition: 'measured',
        revisable: true,
        currency: 'JPY',
        amount,
        amountJpy: amount,
      },
    ],
    ...(revision > 1
      ? { correction: { supersedes: revision - 1, reason: '推定値の改訂' } }
      : {}),
  });
}

/** 各テストが前のテストの書き込みに影響されないよう R2 を空にする。 */
beforeEach(async () => {
  const listed = await env.RECORDS.list();
  await Promise.all(listed.objects.map((object) => env.RECORDS.delete(object.key)));
});

describe('キーの導出', () => {
  it('対象日とリビジョンから決定的に定まる', () => {
    expect(recordKey('2026-09-07', 1)).toBe('records/2026-09-07/001.json');
    expect(recordKey('2026-09-07', 12)).toBe('records/2026-09-07/012.json');
  });

  it('生応答は取得元ごとのキーになる', () => {
    expect(rawKey('2026-09-07', 'claude')).toBe('raw/2026-09-07/claude.json');
  });
});

describe('保存済みオブジェクトの不変性', () => {
  it('新規キーへの書き込みは成功し、正準バイト列がそのまま保存される', async () => {
    const target = record('2026-09-07');

    await putRecord(env.RECORDS, target);

    const stored = await env.RECORDS.get(recordKey('2026-09-07', 1));
    expect(new Uint8Array(await stored!.arrayBuffer())).toEqual(canonicalize(target));
  });

  it('既存キーへの書き込みは失敗し、既存内容は変化しない', async () => {
    const first = record('2026-09-07', 1, '12.00');
    await putRecord(env.RECORDS, first);

    const conflicting = record('2026-09-07', 1, '99.00');
    await expect(putRecord(env.RECORDS, conflicting)).rejects.toThrow(/既に存在/);

    const stored = await env.RECORDS.get(recordKey('2026-09-07', 1));
    expect(new Uint8Array(await stored!.arrayBuffer())).toEqual(canonicalize(first));
  });
});

describe('訂正リビジョン', () => {
  it('新リビジョンが追加され、過去リビジョンも取得できる', async () => {
    await putRecord(env.RECORDS, record('2026-09-07', 1, '12.00'));
    await putRecord(env.RECORDS, record('2026-09-07', 2, '15.00'));

    const latest = await getRecord(env.RECORDS, '2026-09-07');
    const previous = await getRecord(env.RECORDS, '2026-09-07', 1);

    expect(JSON.parse(decoder.decode(latest!)).revision).toBe(2);
    expect(JSON.parse(decoder.decode(previous!)).revision).toBe(1);
  });

  it('訂正理由のない新リビジョンは拒否される', async () => {
    await putRecord(env.RECORDS, record('2026-09-07', 1));

    const withoutReason = createRecord({
      date: '2026-09-07',
      revision: 2,
      generatedAt: '2026-09-08T06:00:00Z',
    });

    await expect(putRecord(env.RECORDS, withoutReason)).rejects.toThrow(/訂正理由/);
  });
});

describe('レコードの取得', () => {
  it('存在しない日は null を返し、空のレコードを生成しない', async () => {
    expect(await getRecord(env.RECORDS, '2026-09-30')).toBeNull();
    expect((await env.RECORDS.list()).objects).toHaveLength(0);
  });

  it('期間指定では存在する日のみが日付昇順で返る', async () => {
    await putRecord(env.RECORDS, record('2026-09-05'));
    await putRecord(env.RECORDS, record('2026-09-07'));

    const results = await listRecords(env.RECORDS, '2026-09-04', '2026-09-08');

    expect(results.map((entry) => entry.date)).toEqual(['2026-09-05', '2026-09-07']);
  });

  it('保存されたバイト列がそのまま返る', async () => {
    const target = record('2026-09-07');
    await putRecord(env.RECORDS, target);

    expect(await getRecord(env.RECORDS, '2026-09-07')).toEqual(canonicalize(target));
  });
});

describe('保存前の妥当性検証', () => {
  it('集計値が明細と一致しないレコードは保存されず、状態も変化しない', async () => {
    const invalid = record('2026-09-07');
    invalid.totals.revenueJpy = '999.00';

    await expect(putRecord(env.RECORDS, invalid)).rejects.toThrow(/totals/);
    expect((await env.RECORDS.list()).objects).toHaveLength(0);
  });
});

describe('生応答の保存', () => {
  it('取得元ごとに保存される', async () => {
    await putRaw(env.RECORDS, '2026-09-07', 'claude', { data: [] });

    const stored = await env.RECORDS.get(rawKey('2026-09-07', 'claude'));
    expect(JSON.parse(await stored!.text())).toEqual({ data: [] });
  });

  it('認証情報を含む応答は拒否される', async () => {
    await expect(
      putRaw(env.RECORDS, '2026-09-07', 'claude', { authorization: 'Bearer secret' }),
    ).rejects.toThrow(/認証情報/);
  });
});
