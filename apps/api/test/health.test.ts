import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('ヘルスチェック', () => {
  it('GET /health が 200 を返す', async () => {
    const response = await SELF.fetch('https://example.com/health');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: 'ok' });
  });

  it('未定義のパスは 404 を返す', async () => {
    const response = await SELF.fetch('https://example.com/unknown');

    expect(response.status).toBe(404);
  });
});
