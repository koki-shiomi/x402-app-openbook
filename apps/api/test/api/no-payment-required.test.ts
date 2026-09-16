import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('運営者向けエンドポイントは支払いを求めない', () => {
  it('GET /health は支払いを求められない', async () => {
    const response = await SELF.fetch('https://example.com/health');

    expect(response.status).toBe(200);
    expect(response.headers.get('payment-required')).toBeNull();
  });

  it('POST /admin/rerun は支払いを求められない（認証は別に必要）', async () => {
    const response = await SELF.fetch('https://example.com/admin/rerun', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ date: '2026-09-15' }),
    });

    // 認証がないため 401 にはなるが、402（支払い要求）にはならない。
    expect(response.status).toBe(401);
    expect(response.headers.get('payment-required')).toBeNull();
  });
});
