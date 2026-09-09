import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('R2 バインディング', () => {
  it('書き込んだオブジェクトをそのまま読み戻せる', async () => {
    const body = '{"a":1}';

    await env.RECORDS.put('test/roundtrip.json', body);
    const stored = await env.RECORDS.get('test/roundtrip.json');

    expect(await stored?.text()).toBe(body);
  });

  it('存在しないキーは null を返す', async () => {
    expect(await env.RECORDS.get('test/missing.json')).toBeNull();
  });
});
