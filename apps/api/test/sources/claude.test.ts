import { describe, expect, it, vi } from 'vitest';

import { centsToUsd, createClaudeSource } from '../../src/sources/claude.js';

/** cost_report の応答を模したフェッチ関数を作る。 */
function stubFetch(body: unknown, ok = true): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), { status: ok ? 200 : 500 }),
  ) as unknown as typeof fetch;
}

/** 実測した応答形式（2026-09-05 分）。 */
const REPORT = {
  data: [
    {
      starting_at: '2026-09-05T00:00:00Z',
      results: [
        {
          currency: 'USD',
          amount: '1.0071',
          workspace_id: null,
          description: 'Claude Haiku 4.5 - Input Tokens',
          model: 'claude-haiku-4-5-20251001',
          cost_type: 'tokens',
        },
        {
          currency: 'USD',
          amount: '0.189',
          workspace_id: null,
          description: 'Claude Haiku 4.5 - Output Tokens',
          model: 'claude-haiku-4-5-20251001',
          cost_type: 'tokens',
        },
      ],
    },
  ],
  has_more: false,
};

const CONFIG = { adminKey: 'sk-ant-admin01-x', workspace: { kind: 'default' as const } };

describe('centsToUsd', () => {
  it('セント値を USD へ変換する', () => {
    expect(centsToUsd('1.0071')).toBe('0.010071');
    expect(centsToUsd('0.189')).toBe('0.001890');
    expect(centsToUsd('2.4118')).toBe('0.024118');
  });

  it('整数のセント値を扱える', () => {
    expect(centsToUsd('100')).toBe('1.000000');
  });

  it('0 を扱える', () => {
    expect(centsToUsd('0')).toBe('0.000000');
  });

  it('USD の小数桁数（6 桁）に必ず揃える', () => {
    for (const cents of ['1.0071', '0.189', '100', '0']) {
      expect(centsToUsd(cents).split('.')[1]).toHaveLength(6);
    }
  });
});

describe('createClaudeSource', () => {
  it('モデル別・入出力別に費用エントリを分ける', async () => {
    const source = createClaudeSource(CONFIG, { fetchImpl: stubFetch(REPORT) });

    const result = await source.collect('2026-09-05');

    expect(result.costs).toHaveLength(2);
    expect(result.costs.map((entry) => entry.category)).toEqual([
      'Claude Haiku 4.5 - Input Tokens',
      'Claude Haiku 4.5 - Output Tokens',
    ]);
  });

  it('取得方式は measured、改訂可能性は偽になる', async () => {
    const source = createClaudeSource(CONFIG, { fetchImpl: stubFetch(REPORT) });

    const [entry] = (await source.collect('2026-09-05')).costs;

    expect(entry).toMatchObject({
      source: 'claude',
      acquisition: 'measured',
      revisable: false,
      currency: 'USD',
    });
    expect(entry?.basis).toBeUndefined();
  });

  it('金額はセントから USD へ変換される', async () => {
    const source = createClaudeSource(CONFIG, { fetchImpl: stubFetch(REPORT) });

    const amounts = (await source.collect('2026-09-05')).costs.map((e) => e.amount);

    expect(amounts).toEqual(['0.010071', '0.001890']);
  });

  it('利用がなかった日は費用エントリを作らない', async () => {
    const empty = { data: [{ starting_at: '2026-09-07T00:00:00Z', results: [] }] };
    const source = createClaudeSource(CONFIG, { fetchImpl: stubFetch(empty) });

    expect((await source.collect('2026-09-07')).costs).toEqual([]);
  });

  it('生応答を保存対象として返す', async () => {
    const source = createClaudeSource(CONFIG, { fetchImpl: stubFetch(REPORT) });

    expect((await source.collect('2026-09-05')).raw).toEqual(REPORT);
  });

  it('取得に失敗した場合は例外を投げる', async () => {
    const source = createClaudeSource(CONFIG, { fetchImpl: stubFetch({}, false) });

    await expect(source.collect('2026-09-05')).rejects.toThrow();
  });
});

describe('対象ワークスペースの限定', () => {
  const MIXED = {
    data: [
      {
        starting_at: '2026-09-05T00:00:00Z',
        results: [
          { currency: 'USD', amount: '1.0071', workspace_id: null, description: 'sizet 分' },
          {
            currency: 'USD',
            amount: '50.0',
            workspace_id: 'wrkspc_other',
            description: '他用途',
          },
        ],
      },
    ],
  };

  it('既定ワークスペースを指定すると識別子が空値の費用のみを対象にする', async () => {
    const source = createClaudeSource(CONFIG, { fetchImpl: stubFetch(MIXED) });

    const costs = (await source.collect('2026-09-05')).costs;

    expect(costs).toHaveLength(1);
    expect(costs[0]?.category).toBe('sizet 分');
  });

  it('ワークスペース ID を指定するとその費用のみを対象にする', async () => {
    const source = createClaudeSource(
      { ...CONFIG, workspace: { kind: 'id', workspaceId: 'wrkspc_other' } },
      { fetchImpl: stubFetch(MIXED) },
    );

    const costs = (await source.collect('2026-09-05')).costs;

    expect(costs).toHaveLength(1);
    expect(costs[0]?.category).toBe('他用途');
  });
});

describe('変換の妥当性検証', () => {
  /**
   * 実測した使用量レポート（2026-09-05 / 2026-09-06 分）。
   * Haiku 4.5 の公開単価は入力 $1/MTok、出力 $5/MTok。
   */
  const USAGE = [
    { date: '2026-09-05', inputTokens: 10071, outputTokens: 378 },
    { date: '2026-09-06', inputTokens: 24118, outputTokens: 826 },
  ];

  /** 実測した cost_report の応答（セント単位）。 */
  const COSTS = [
    { date: '2026-09-05', inputCents: '1.0071', outputCents: '0.189' },
    { date: '2026-09-06', inputCents: '2.4118', outputCents: '0.413' },
  ];

  it('トークン数と公開単価から算出した費用が、変換後の金額と一致する', () => {
    for (const [index, usage] of USAGE.entries()) {
      const cost = COSTS[index]!;

      // 入力: トークン数 × $1 / 1,000,000
      const expectedInput = (usage.inputTokens / 1_000_000).toFixed(6);
      // 出力: トークン数 × $5 / 1,000,000
      const expectedOutput = ((usage.outputTokens * 5) / 1_000_000).toFixed(6);

      expect(centsToUsd(cost.inputCents)).toBe(expectedInput);
      expect(centsToUsd(cost.outputCents)).toBe(expectedOutput);
    }
  });

  it('応答値をそのまま USD として扱うと 100 倍になることを示す', () => {
    const asIs = Number('1.0071');
    const converted = Number(centsToUsd('1.0071'));

    expect(asIs / converted).toBeCloseTo(100, 6);
  });
});
