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
    /**
     * 1 件あたりの待ち時間の上限。
     *
     * 既定の 5 秒では、全テストを並列に実行したときに稀に超える。刻印の署名など
     * CPU を使う処理が、実行環境の負荷しだいで 10 秒近くかかることを実測している。
     * 待ち時間の超過が実際の不具合ではなく負荷の揺らぎで起きると、無関係な失敗を
     * 追うことになるため、余裕を持たせる。
     */
    testTimeout: 30_000,
  },
});
