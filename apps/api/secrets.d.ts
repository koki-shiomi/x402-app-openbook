/**
 * wrangler secret で与える値の型宣言。
 *
 * wrangler.jsonc の vars に置くと値が設定ファイルと生成型に残るため、
 * シークレットはここで型だけを宣言し、値は本番では `wrangler secret put`、
 * テストでは vitest の miniflare バインディングで与える。
 */
interface __BaseEnv_Env {
  /** 手動再実行エンドポイントの共有シークレット。 */
  ADMIN_TOKEN: string;
}
