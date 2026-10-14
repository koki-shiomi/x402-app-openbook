import { describe, expect, it } from 'vitest';
import worker from '../src/maintenance.js';

describe('移行用 Worker', () => {
  it('停止状態を確認でき、取得・手動実行・画面では課金も書込みも行わない', async () => {
    const health = await worker.fetch(new Request('https://example.com/health'));
    expect(await health.json()).toEqual({ status: 'maintenance', writesStopped: true });
    for (const path of ['/', '/v1/records', '/v1/records/2026-10-03', '/admin/rerun']) {
      const response = await worker.fetch(new Request(`https://example.com${path}`, { method: 'POST' }));
      expect(response.status).toBe(503);
      expect(response.headers.has('PAYMENT-REQUIRED')).toBe(false);
    }
    await expect(worker.scheduled()).resolves.toBeUndefined();
  });
});
