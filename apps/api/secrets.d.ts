/**
 * wrangler secret で与える値の型宣言。
 *
 * wrangler.jsonc の vars に置くと値が設定ファイルと生成型に残るため、
 * シークレットはここで型だけを宣言し、値は本番では `wrangler secret put`、
 * テストでは vitest の miniflare バインディングで与える。
 *
 * 認証情報は、提供元が読み取り専用の権限を提供している場合はそれに絞る。
 * 詳細は specs/provider-credentials/spec.md を参照。
 */
interface __BaseEnv_Env {
  /** 手動再実行エンドポイントの共有シークレット。 */
  ADMIN_TOKEN: string;

  /** Claude の Admin API キー。スコープを絞る手段がないため権限は全開になる。 */
  CLAUDE_ADMIN_KEY?: string;
  /** 費用の対象ワークスペース。既定ワークスペースは `default` を指定する。 */
  CLAUDE_WORKSPACE?: string;

  /** Cloudflare の API トークン。デプロイ用と兼用しており、請求情報の読み取りに加えて Workers・R2 の編集権限を持つ。 */
  CLOUDFLARE_BILLING_TOKEN?: string;
  /** Cloudflare のアカウント ID。 */
  CLOUDFLARE_ACCOUNT_ID?: string;

  /** Resend の API キー。読み取り専用の権限が提供されておらず、送信数の取得に必要な full_access のため権限は全開になる。 */
  RESEND_API_KEY?: string;
  /** 宣言するプラン。無料は `free`、有料は `<プラン名>:<月額USD>`。 */
  RESEND_PLAN?: string;

  /** Supabase の読み取り専用パーソナルアクセストークン。 */
  SUPABASE_PAT?: string;
  /** Supabase の組織 slug。 */
  SUPABASE_ORG_SLUG?: string;

  /** AdMob の OAuth クライアント ID。 */
  ADMOB_CLIENT_ID?: string;
  /** AdMob の OAuth クライアントシークレット。 */
  ADMOB_CLIENT_SECRET?: string;
  /**
   * AdMob のリフレッシュトークン。スコープは admob.report のみ。
   *
   * OAuth 同意画面の公開ステータスを本番にしてから発行する。テスト状態のまま
   * 発行したものは 7 日で失効する。6 か月使われないトークンも失効し、同一の
   * Google アカウントと OAuth クライアントの組で 100 件を超えて発行すると、
   * 最も古いトークンが警告なく無効になる。
   */
  ADMOB_REFRESH_TOKEN?: string;
  /** AdMob のパブリッシャー ID（`pub-` で始まる）。 */
  ADMOB_PUBLISHER_ID?: string;
  /** 収益の対象とする sizet のアプリ ID（`ca-app-pub-` で始まる）。 */
  ADMOB_APP_ID?: string;
}
