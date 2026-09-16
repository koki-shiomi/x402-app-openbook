/**
 * 刻印の設定値と署名鍵の読み取り。
 *
 * いずれかが欠けている場合は刻印を行わず、未設定の項目名を実行記録に残す。
 * 収集は通常どおり行う。詳細は specs/hash-anchoring/spec.md を参照。
 */

/** 刻印に必要なシークレットの名前。 */
const REQUIRED = ['ARC_SIGNER_PRIVATE_KEY', 'ARC_RPC_URL', 'ARC_ANCHOR_CONTRACT'] as const;

/** シークレットとして与えられる値。 */
export type AnchorConfigInput = Partial<Record<(typeof REQUIRED)[number], string>>;

/** 刻印に用いる設定。 */
export interface AnchorConfig {
  /** 刻印専用の EOA の秘密鍵。 */
  signerPrivateKey: string;
  /** RPC の URL。 */
  rpcUrl: string;
  /** 刻印のコントラクトのアドレス。 */
  contractAddress: string;
}

/** 設定の解決結果。 */
export interface AnchorConfigResult {
  /** すべてそろった場合の設定。 */
  config?: AnchorConfig;
  /** 未設定のシークレットの名前。 */
  missing: string[];
}

/**
 * 刻印の設定を読み取る。
 *
 * @param input シークレットとして与えられた値
 * @returns 設定、または未設定の項目名
 */
export function loadAnchorConfig(input: AnchorConfigInput): AnchorConfigResult {
  const missing = REQUIRED.filter((name) => (input[name] ?? '') === '');
  if (missing.length > 0) {
    return { missing: [...missing] };
  }

  return {
    config: {
      signerPrivateKey: input.ARC_SIGNER_PRIVATE_KEY!,
      rpcUrl: input.ARC_RPC_URL!,
      contractAddress: input.ARC_ANCHOR_CONTRACT!,
    },
    missing: [],
  };
}
