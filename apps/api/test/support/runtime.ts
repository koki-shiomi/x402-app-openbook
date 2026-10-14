/** 本番のWrangler設定やWeb生成物を読み込まない、テスト専用のWorkers環境。 */
export const TEST_RUNTIME = {
  main: './src/index.ts',
  remoteBindings: false,
  miniflare: {
    compatibilityDate: '2026-08-22',
    compatibilityFlags: ['nodejs_compat'],
    r2Buckets: ['RECORDS'],
    bindings: { ADMIN_TOKEN: 'test-token' },
  },
};
