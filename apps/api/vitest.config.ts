import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        // 本番では wrangler secret で与える値をテスト用に固定する。
        bindings: { ADMIN_TOKEN: 'test-token' },
      },
    }),
  ],
  test: {
    globals: true,
    include: ['test/**/*.test.ts'],
  },
});
