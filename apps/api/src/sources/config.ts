/**
 * 費用収集の設定値と認証情報の読み取り。
 *
 * 認証情報が欠けている提供元は収集を試みず欠測として記録する。0 円として
 * 記録すると「無料枠内で 0 円」と「そもそも取得していない」が公開データ上で
 * 区別できなくなる。詳細は specs/provider-credentials/spec.md を参照。
 */

/** 既定ワークスペースを指す設定値。応答上の識別子は空値になる。 */
const DEFAULT_WORKSPACE = 'default';

/** 対象ワークスペースの解決結果。 */
export type WorkspaceFilter =
  /** 既定ワークスペース（応答上の識別子が空値のもの）を対象とする。 */
  | { kind: 'default' }
  /** 指定した ID のワークスペースを対象とする。 */
  | { kind: 'id'; workspaceId: string }
  /** 設定値そのものが与えられていない。 */
  | { kind: 'unset' };

/**
 * 対象ワークスペースの設定値を解決する。
 *
 * 既定ワークスペースは応答上の識別子が空値になるため、設定値をそのまま空値に
 * すると「既定を意図して選んだ」のか「設定し忘れた」のかを区別できない。
 * 明示的な値 `default` を用いることで両者を分ける。
 *
 * @param value 設定値
 * @returns 解決結果
 */
export function resolveWorkspaceFilter(value: string | undefined): WorkspaceFilter {
  if (value === undefined || value === '') {
    return { kind: 'unset' };
  }

  return value === DEFAULT_WORKSPACE
    ? { kind: 'default' }
    : { kind: 'id', workspaceId: value };
}

/** 環境から読み取る設定値。 */
export interface CostConfigInput {
  CLAUDE_ADMIN_KEY?: string | undefined;
  CLAUDE_WORKSPACE?: string | undefined;
  CLOUDFLARE_BILLING_TOKEN?: string | undefined;
  CLOUDFLARE_ACCOUNT_ID?: string | undefined;
  RESEND_API_KEY?: string | undefined;
  RESEND_PLAN?: string | undefined;
  SUPABASE_PAT?: string | undefined;
  SUPABASE_ORG_SLUG?: string | undefined;
}

/** 対象が確定しているワークスペース指定。未設定は設定として成立しない。 */
export type ResolvedWorkspace = Exclude<WorkspaceFilter, { kind: 'unset' }>;

/** Claude の費用取得に必要な設定。 */
export interface ClaudeConfig {
  adminKey: string;
  /** 未設定は ClaudeConfig として成立しないため、型から除いている。 */
  workspace: ResolvedWorkspace;
}

/** Cloudflare の費用取得に必要な設定。 */
export interface CloudflareConfig {
  token: string;
  accountId: string;
}

/** Resend の費用取得に必要な設定。 */
export interface ResendConfig {
  apiKey: string;
  /** 宣言したプラン名。 */
  plan: string;
  /** 有料プランの場合の月額（USD）。無料プランでは持たない。 */
  monthlyAmountUsd?: string;
}

/** Supabase の費用取得に必要な設定。 */
export interface SupabaseConfig {
  pat: string;
  orgSlug: string;
}

/** 設定が欠けている提供元と、その理由。 */
export interface MissingConfig {
  source: string;
  reason: string;
}

/** 費用収集全体の設定。 */
export interface CostConfig {
  claude?: ClaudeConfig;
  cloudflare?: CloudflareConfig;
  resend?: ResendConfig;
  supabase?: SupabaseConfig;
  /** 設定が欠けている提供元。収集時に欠測として記録する。 */
  missing: MissingConfig[];
}

/**
 * Resend のプラン宣言を解釈する。
 *
 * 無料プランは `free`、有料プランは `<プラン名>:<月額USD>` の形式で宣言する。
 *
 * @param value プラン宣言の設定値
 * @returns プラン名と月額
 */
function parseResendPlan(value: string): { plan: string; monthlyAmountUsd?: string } {
  const [plan, amount] = value.split(':');

  return amount === undefined
    ? { plan: plan ?? value }
    : { plan: plan ?? value, monthlyAmountUsd: amount };
}

/**
 * 環境から費用収集の設定を読み取る。
 *
 * 必要な値が揃っている提供元だけを設定として返し、欠けている提供元は理由とともに
 * `missing` に記録する。
 *
 * @param input 環境から読み取った設定値
 * @returns 費用収集の設定
 */
export function loadCostConfig(input: CostConfigInput): CostConfig {
  const missing: MissingConfig[] = [];
  const config: CostConfig = { missing };

  const workspace = resolveWorkspaceFilter(input.CLAUDE_WORKSPACE);
  if (input.CLAUDE_ADMIN_KEY === undefined || input.CLAUDE_ADMIN_KEY === '') {
    missing.push({ source: 'claude', reason: 'CLAUDE_ADMIN_KEY が設定されていません' });
  } else if (workspace.kind === 'unset') {
    missing.push({
      source: 'claude',
      reason: 'CLAUDE_WORKSPACE が設定されていません（既定ワークスペースを対象とする場合は default を指定します）',
    });
  } else {
    config.claude = { adminKey: input.CLAUDE_ADMIN_KEY, workspace };
  }

  if (
    input.CLOUDFLARE_BILLING_TOKEN === undefined ||
    input.CLOUDFLARE_BILLING_TOKEN === '' ||
    input.CLOUDFLARE_ACCOUNT_ID === undefined ||
    input.CLOUDFLARE_ACCOUNT_ID === ''
  ) {
    missing.push({
      source: 'cloudflare',
      reason: 'CLOUDFLARE_BILLING_TOKEN または CLOUDFLARE_ACCOUNT_ID が設定されていません',
    });
  } else {
    config.cloudflare = {
      token: input.CLOUDFLARE_BILLING_TOKEN,
      accountId: input.CLOUDFLARE_ACCOUNT_ID,
    };
  }

  if (
    input.RESEND_API_KEY === undefined ||
    input.RESEND_API_KEY === '' ||
    input.RESEND_PLAN === undefined ||
    input.RESEND_PLAN === ''
  ) {
    missing.push({
      source: 'resend',
      reason: 'RESEND_API_KEY または RESEND_PLAN が設定されていません',
    });
  } else {
    config.resend = { apiKey: input.RESEND_API_KEY, ...parseResendPlan(input.RESEND_PLAN) };
  }

  if (
    input.SUPABASE_PAT === undefined ||
    input.SUPABASE_PAT === '' ||
    input.SUPABASE_ORG_SLUG === undefined ||
    input.SUPABASE_ORG_SLUG === ''
  ) {
    missing.push({
      source: 'supabase',
      reason: 'SUPABASE_PAT または SUPABASE_ORG_SLUG が設定されていません',
    });
  } else {
    config.supabase = { pat: input.SUPABASE_PAT, orgSlug: input.SUPABASE_ORG_SLUG };
  }

  return config;
}
