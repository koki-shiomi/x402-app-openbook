import { describe, expect, it } from 'vitest';

import { canonicalize } from '../src/canonical.js';
import { buildRecord } from './test-fixtures.js';

const decoder = new TextDecoder();

describe('canonicalize', () => {
  it('項目の生成順序が異なる同一内容から同一バイト列が得られる', () => {
    const base = buildRecord();
    const reordered = {
      generatedAt: base.generatedAt,
      exchangeRates: base.exchangeRates,
      totals: base.totals,
      incomplete: base.incomplete,
      revenues: base.revenues,
      costs: base.costs,
      revision: base.revision,
      date: base.date,
      schemaVersion: base.schemaVersion,
    };

    expect(canonicalize(reordered)).toEqual(canonicalize(base));
  });

  it('費用エントリを異なる順序で与えても同一バイト列になる', () => {
    const first = buildRecord({
      costs: [
        { ...buildRecord().costs[0]!, source: 'cloudflare', category: 'workers' },
        { ...buildRecord().costs[0]!, source: 'claude', category: 'input-tokens' },
      ],
    });
    const second = buildRecord({
      costs: [
        { ...buildRecord().costs[0]!, source: 'claude', category: 'input-tokens' },
        { ...buildRecord().costs[0]!, source: 'cloudflare', category: 'workers' },
      ],
    });

    expect(canonicalize(first)).toEqual(canonicalize(second));
  });

  it('金額を最小桁だけ変えるとバイト列が変わる', () => {
    const base = buildRecord();
    const changed = buildRecord({
      costs: [{ ...base.costs[0]!, amount: '0.010072' }],
    });

    expect(canonicalize(changed)).not.toEqual(canonicalize(base));
  });

  it('incomplete も規定どおり整列される', () => {
    const items = [
      { kind: 'source' as const, id: 'supabase', reason: 'timeout' },
      { kind: 'exchange-rate' as const, id: 'USD/JPY', reason: 'timeout' },
    ];
    const forward = canonicalize(buildRecord({ incomplete: items }));
    const reversed = canonicalize(buildRecord({ incomplete: [...items].reverse() }));

    expect(forward).toEqual(reversed);
    const parsed = JSON.parse(decoder.decode(forward)) as {
      incomplete: { kind: string; id: string }[];
    };
    expect(parsed.incomplete.map((item) => item.kind)).toEqual([
      'exchange-rate',
      'source',
    ]);
  });

  it('オブジェクトのキーは辞書順に並び、空白を含まない', () => {
    const json = decoder.decode(canonicalize({ b: 1, a: 2 }));

    expect(json).toBe('{"a":2,"b":1}');
  });

  it('非 ASCII 文字はエスケープせずそのまま出力する', () => {
    const json = decoder.decode(canonicalize({ reason: '取得失敗' }));

    expect(json).toBe('{"reason":"取得失敗"}');
  });
});
