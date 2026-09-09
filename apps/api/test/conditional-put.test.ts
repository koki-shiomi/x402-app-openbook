import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

/**
 * design.md の決定 2 の注意点を検証する。
 * 条件付き書き込みが単独で機能するかを確認し、事前確認との併用が必要かを判断する。
 */
describe('R2 の条件付き書き込み', () => {
  it('存在しないキーへの onlyIf 付き書き込みは成功する', async () => {
    const result = await env.RECORDS.put('cond/new.json', 'first', {
      onlyIf: { etagDoesNotMatch: '*' },
    });

    expect(result).not.toBeNull();
  });

  it('既存キーへの onlyIf 付き書き込みは失敗し、内容が変化しない', async () => {
    await env.RECORDS.put('cond/existing.json', 'first');

    const result = await env.RECORDS.put('cond/existing.json', 'second', {
      onlyIf: { etagDoesNotMatch: '*' },
    });

    const stored = await env.RECORDS.get('cond/existing.json');
    expect(await stored?.text()).toBe('first');
    expect(result).toBeNull();
  });
});
