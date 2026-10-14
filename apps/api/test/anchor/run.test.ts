import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { sha256Hex, ZERO_HASH } from '@openbook/shared';

import { runAnchoring } from '../../src/anchor/index.js';
import type { AnchorChain } from '../../src/anchor/chain.js';
import { readAnchorRecord } from '../../src/anchor/store.js';
import type { ChainState } from '../../src/anchor/reconcile.js';
import { readAnchorRuns } from '../../src/anchor/store.js';
import { recordKey } from '../../src/storage.js';

const CONTRACT = '0xC039722204Dde6DF3dFb48a9a3068163d30b997a';
const NOW = '2026-09-16T06:00:10.000Z';

const CONFIG = {
  ARC_SIGNER_PRIVATE_KEY:
    '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  ARC_RPC_URL: 'https://rpc.mainnet.arc.io',
  ARC_ANCHOR_CONTRACT: CONTRACT,
};

beforeEach(async () => {
  const listed = await env.RECORDS.list();
  await Promise.all(listed.objects.map((object) => env.RECORDS.delete(object.key)));
});

/** 対象日のレコードを保存し、そのバイト列を返す。 */
async function putRecordAt(date: string, revision: number, amount = '12.00'): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(
    `{"date":"${date}","revision":${revision},"totals":{"revenueJpy":"${amount}"}}`,
  );
  await env.RECORDS.put(recordKey(date, revision), bytes);
  return bytes;
}

/** チェーンの代わりに用いる実装。送信した刻印を記録する。 */
function fakeChain(
  options: {
    states?: Record<string, ChainState>;
    chainId?: number;
    failOn?: 'chainId' | 'read' | 'send';
    error?: Error;
  } = {},
): AnchorChain & { sent: { date: string; revision: number; hash: string }[][] } {
  const sent: { date: string; revision: number; hash: string }[][] = [];

  return {
    contractAddress: CONTRACT,
    sent,
    async chainId() {
      if (options.failOn === 'chainId') {
        throw options.error ?? new Error('RPC へ接続できません');
      }
      return options.chainId ?? 5042;
    },
    async readStates(targets) {
      if (options.failOn === 'read') {
        throw options.error ?? new Error('RPC へ接続できません');
      }
      return targets.map(
        (target) =>
          options.states?.[`${target.date}/${target.revision}`] ?? {
            anchoredHash: ZERO_HASH,
            latestRevision: 0,
          },
      );
    },
    async anchor(items) {
      if (options.failOn === 'send') {
        throw options.error ?? new Error('トランザクションが拒否されました');
      }
      sent.push(items.map((item) => ({ ...item })));
      return { transactionHash: '0xtx', blockNumber: 1234 };
    },
  };
}

describe('刻印の実行', () => {
  it('同じアドレスでも旧テストネットへの送信は拒否する', async () => {
    await putRecordAt('2026-09-15', 1);
    const chain = fakeChain({ chainId: 5042002 });
    const log = await runAnchoring(env.RECORDS, CONFIG, { now: NOW, createChain: () => chain });
    expect(log).toMatchObject({ ok: false, chainId: 5042002 });
    expect(chain.sent).toEqual([]);
    expect(await readAnchorRecord(env.RECORDS, '2026-09-15', 1)).toBeNull();
  });

  it('メインネットへ送信しチェーン ID 5042 を記録する', async () => {
    await putRecordAt('2026-09-15', 1);
    const chain = fakeChain({ chainId: 5042 });
    const log = await runAnchoring(env.RECORDS, CONFIG, { now: NOW, createChain: () => chain });
    expect(log).toMatchObject({ ok: true, chainId: 5042 });
    expect(chain.sent).toHaveLength(1);
    expect(await readAnchorRecord(env.RECORDS, '2026-09-15', 1)).toMatchObject({ chainId: 5042 });
  });

  it('保存されたバイト列から算出したハッシュを刻印する', async () => {
    const bytes = await putRecordAt('2026-09-15', 1);
    const chain = fakeChain();

    await runAnchoring(env.RECORDS, CONFIG, { now: NOW, createChain: () => chain });

    expect(chain.sent[0]).toEqual([
      { date: '2026-09-15', revision: 1, hash: await sha256Hex(bytes) },
    ]);
  });

  it('複数の対象を 1 件のトランザクションで送る', async () => {
    await putRecordAt('2026-09-14', 1);
    await putRecordAt('2026-09-15', 2);
    const chain = fakeChain();

    await runAnchoring(env.RECORDS, CONFIG, { now: NOW, createChain: () => chain });

    expect(chain.sent).toHaveLength(1);
    expect(chain.sent[0]?.map((item) => item.date)).toEqual(['2026-09-15', '2026-09-14']);
  });

  it('刻印が成立したリビジョンの結果を保存する', async () => {
    const bytes = await putRecordAt('2026-09-15', 1);
    const chain = fakeChain();

    const log = await runAnchoring(env.RECORDS, CONFIG, { now: NOW, createChain: () => chain });

    expect(await readAnchorRecord(env.RECORDS, '2026-09-15', 1)).toEqual({
      date: '2026-09-15',
      revision: 1,
      hash: await sha256Hex(bytes),
      chainId: 5042,
      contractAddress: CONTRACT,
      transactionHash: '0xtx',
      blockNumber: 1234,
      recordedAt: NOW,
    });
    expect(log).toMatchObject({ ok: true, transactionHash: '0xtx', blockNumber: 1234 });
  });

  it('刻印が成立しなければ結果を保存せず、次の実行で再び対象になる', async () => {
    await putRecordAt('2026-09-15', 1);

    const log = await runAnchoring(env.RECORDS, CONFIG, {
      now: NOW,
      createChain: () => fakeChain({ failOn: 'send' }),
    });

    expect(log.ok).toBe(false);
    expect(await readAnchorRecord(env.RECORDS, '2026-09-15', 1)).toBeNull();

    const retry = fakeChain();
    await runAnchoring(env.RECORDS, CONFIG, {
      now: '2026-09-16T07:00:00.000Z',
      createChain: () => retry,
    });

    expect(retry.sent[0]?.map((item) => item.date)).toEqual(['2026-09-15']);
  });

  it('受領の待機がタイムアウトした場合は結果を保存しない', async () => {
    await putRecordAt('2026-09-15', 1);

    const log = await runAnchoring(env.RECORDS, CONFIG, {
      now: NOW,
      createChain: () => fakeChain({ failOn: 'send', error: new Error('受領の待機がタイムアウトしました') }),
    });

    expect(log).toMatchObject({ ok: false, reason: expect.stringMatching(/タイムアウト/) });
    expect(await readAnchorRecord(env.RECORDS, '2026-09-15', 1)).toBeNull();
  });

  it('刻印済みで結果の記録が欠けている対象は、送信せず記録だけを補う', async () => {
    const bytes = await putRecordAt('2026-09-15', 1);
    const hash = await sha256Hex(bytes);
    const chain = fakeChain({ states: { '2026-09-15/1': { anchoredHash: hash, latestRevision: 1 } } });

    await runAnchoring(env.RECORDS, CONFIG, { now: NOW, createChain: () => chain });

    expect(chain.sent).toEqual([]);
    const stored = await readAnchorRecord(env.RECORDS, '2026-09-15', 1);
    expect(stored).toMatchObject({ hash, chainId: 5042 });
    expect(stored?.transactionHash).toBeUndefined();
  });

  it('保存済みの結果を上書きしない', async () => {
    await putRecordAt('2026-09-15', 1);
    await runAnchoring(env.RECORDS, CONFIG, { now: NOW, createChain: () => fakeChain() });

    const before = await readAnchorRecord(env.RECORDS, '2026-09-15', 1);

    // 同じリビジョンを対象に含む実行を、記録の時刻を変えて行う。
    await runAnchoring(env.RECORDS, CONFIG, {
      now: '2026-09-17T06:00:00.000Z',
      createChain: () => fakeChain(),
    });

    expect(await readAnchorRecord(env.RECORDS, '2026-09-15', 1)).toEqual(before);
  });

  it('対象がなければトランザクションを送らない', async () => {
    const chain = fakeChain();

    const log = await runAnchoring(env.RECORDS, CONFIG, { now: NOW, createChain: () => chain });

    expect(chain.sent).toEqual([]);
    expect(log).toMatchObject({ ok: true, targets: [] });
    expect(log.transactionHash).toBeUndefined();
  });

  it('チェーン ID が想定と異なれば送信しない', async () => {
    await putRecordAt('2026-09-15', 1);
    const chain = fakeChain({ chainId: 1 });

    const log = await runAnchoring(env.RECORDS, CONFIG, { now: NOW, createChain: () => chain });

    expect(chain.sent).toEqual([]);
    expect(log).toMatchObject({ ok: false, reason: expect.stringMatching(/チェーン ID/) });
  });

  it('チェーン上のハッシュが保存物と一致しなければ不一致として残す', async () => {
    await putRecordAt('2026-09-15', 1);
    const chain = fakeChain({
      states: {
        '2026-09-15/1': {
          anchoredHash: '0xbb22222222222222222222222222222222222222222222222222222222222222',
          latestRevision: 1,
        },
      },
    });

    const log = await runAnchoring(env.RECORDS, CONFIG, { now: NOW, createChain: () => chain });

    expect(chain.sent).toEqual([]);
    expect(log.anomalies).toEqual([
      expect.objectContaining({ date: '2026-09-15', revision: 1 }),
    ]);
  });
});

describe('刻印の失敗と実行記録', () => {
  it('RPC に接続できなければ理由を残し、レコードは変えない', async () => {
    await putRecordAt('2026-09-15', 1);
    const before = await env.RECORDS.get(recordKey('2026-09-15', 1));

    const log = await runAnchoring(env.RECORDS, CONFIG, {
      now: NOW,
      createChain: () => fakeChain({ failOn: 'read' }),
    });

    expect(log).toMatchObject({ ok: false, reason: expect.stringMatching(/RPC/) });
    expect(await (await env.RECORDS.get(recordKey('2026-09-15', 1)))!.text()).toBe(
      await before!.text(),
    );
  });

  it('対象・送信・次の実行へ回した対象を実行記録に残す', async () => {
    await putRecordAt('2026-09-15', 1);
    await runAnchoring(env.RECORDS, CONFIG, { now: NOW, createChain: () => fakeChain() });

    const runs = await readAnchorRuns(env.RECORDS);

    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      startedAt: NOW,
      finishedAt: NOW,
      ok: true,
      chainId: 5042,
      contractAddress: CONTRACT,
      transactionHash: '0xtx',
      blockNumber: 1234,
      targets: [{ date: '2026-09-15', revision: 1 }],
      anchored: [{ date: '2026-09-15', revision: 1 }],
      deferred: [],
    });
  });

  it('同じ日に 2 回実行しても先の実行記録を上書きしない', async () => {
    await putRecordAt('2026-09-15', 1);
    await runAnchoring(env.RECORDS, CONFIG, { now: NOW, createChain: () => fakeChain() });
    await putRecordAt('2026-09-15', 2);
    await runAnchoring(env.RECORDS, CONFIG, {
      now: '2026-09-16T09:30:00.000Z',
      createChain: () => fakeChain(),
    });

    const runs = await readAnchorRuns(env.RECORDS);

    expect(runs).toHaveLength(2);
    expect(runs.map((run) => run.startedAt)).toEqual([NOW, '2026-09-16T09:30:00.000Z']);
  });

  it('署名鍵が未設定なら刻印を行わず、未設定の項目名を残す', async () => {
    await putRecordAt('2026-09-15', 1);
    const { ARC_SIGNER_PRIVATE_KEY: _omit, ...partial } = CONFIG;

    const log = await runAnchoring(env.RECORDS, partial, {
      now: NOW,
      createChain: () => {
        throw new Error('設定が欠けている場合はチェーンへ接続しない');
      },
    });

    expect(log).toMatchObject({ ok: false, missingSecrets: ['ARC_SIGNER_PRIVATE_KEY'] });
    expect(await readAnchorRecord(env.RECORDS, '2026-09-15', 1)).toBeNull();
    expect(await env.RECORDS.get(recordKey('2026-09-15', 1))).not.toBeNull();
  });

  it('実行記録に署名鍵を含めない', async () => {
    await putRecordAt('2026-09-15', 1);
    await runAnchoring(env.RECORDS, CONFIG, { now: NOW, createChain: () => fakeChain() });

    const runs = await readAnchorRuns(env.RECORDS);

    expect(JSON.stringify(runs)).not.toContain(CONFIG.ARC_SIGNER_PRIVATE_KEY);
    expect(JSON.stringify(runs)).not.toContain(CONFIG.ARC_SIGNER_PRIVATE_KEY.slice(2));
  });
});
