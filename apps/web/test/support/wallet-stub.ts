import { privateKeyToAccount } from 'viem/accounts';

/**
 * テスト用の `window.ethereum` の疑似の実装。
 *
 * 画面が用いる 5 つの口だけを持つ。異常系（未接続・チェーン違い・追加の拒否）は
 * 戻り値の設定で作る。署名は viem の局所アカウントに行わせるため、本物の署名に
 * なる。詳細は design.md の決定 8 を参照。
 */

/** テスト用の秘密鍵。公開されている既知の値であり、資産を持たせない。 */
export const TEST_PRIVATE_KEY =
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';

/** 疑似の実装が受け取ったトランザクション 1 件。 */
export interface SentTransaction {
  from?: string;
  to?: string;
  data?: string;
}

/** 疑似の実装の初期状態。 */
export interface WalletStubOptions {
  /** 接続先のチェーン ID。 */
  chainId: number;
  /** 既に接続済みとして扱うか。既定は接続済み。 */
  connected?: boolean;
  /** チェーンの追加の要求を受理するか。既定は受理する。 */
  acceptAddChain?: boolean;
  /** 送ったトランザクションに対して返す取引の識別子。 */
  transactionHash?: string;
}

/** EIP-1193 の要求 1 件。 */
export interface EthereumRequest {
  method: string;
  params?: unknown[];
}

/** 画面が用いる範囲の EIP-1193 プロバイダ。 */
export interface WalletStub {
  request(request: EthereumRequest): Promise<unknown>;
  /** テストから現在のチェーン ID を読む。 */
  readonly chainId: number;
  /** テストから送られたトランザクションを検査する。 */
  readonly sent: readonly SentTransaction[];
}

/**
 * ウォレットの疑似の実装を作る。
 *
 * @param options 初期状態
 * @returns 疑似のプロバイダ
 */
export function createWalletStub(options: WalletStubOptions): WalletStub {
  const account = privateKeyToAccount(TEST_PRIVATE_KEY);

  let chainId = options.chainId;
  let connected = options.connected ?? true;
  const acceptAddChain = options.acceptAddChain ?? true;
  const transactionHash = options.transactionHash ?? `0x${'ab'.repeat(32)}`;
  const sent: SentTransaction[] = [];

  return {
    get chainId(): number {
      return chainId;
    },

    get sent(): readonly SentTransaction[] {
      return sent;
    },

    async request({ method, params }: EthereumRequest): Promise<unknown> {
      switch (method) {
        case 'eth_accounts':
          return connected ? [account.address] : [];

        case 'eth_requestAccounts':
          connected = true;
          return [account.address];

        case 'eth_chainId':
          return `0x${chainId.toString(16)}`;

        case 'wallet_switchEthereumChain': {
          const target = (params?.[0] as { chainId?: string } | undefined)?.chainId;
          if (target === undefined) {
            throw new Error('chainId が指定されていません');
          }
          chainId = Number.parseInt(target, 16);
          return null;
        }

        case 'wallet_addEthereumChain': {
          if (!acceptAddChain) {
            // 利用者が追加を拒んだ場合に合わせる。
            throw new Error('利用者がチェーンの追加を拒みました');
          }
          const target = (params?.[0] as { chainId?: string } | undefined)?.chainId;
          if (target !== undefined) {
            chainId = Number.parseInt(target, 16);
          }
          return null;
        }

        case 'eth_sendTransaction': {
          const transaction = params?.[0] as SentTransaction | undefined;
          if (transaction === undefined) {
            throw new Error('トランザクションの内容がありません');
          }
          sent.push(transaction);
          return transactionHash;
        }

        case 'eth_signTypedData_v4': {
          const payload = params?.[1];
          if (typeof payload !== 'string') {
            throw new Error('署名する内容が文字列ではありません');
          }
          return await account.signTypedData(parseTypedData(payload));
        }

        default:
          throw new Error(`扱わない要求です: ${method}`);
      }
    },
  };
}

/**
 * 署名の要求の内容を viem が扱える形へ直す。
 *
 * EIP-1193 では JSON の文字列で渡るため、数値の項目が文字列になっている。
 * viem は `uint256` に BigInt を求めるため、型に合わせて戻す。
 *
 * @param payload JSON の文字列
 * @returns viem の `signTypedData` へ渡す内容
 */
function parseTypedData(payload: string): Parameters<
  ReturnType<typeof privateKeyToAccount>['signTypedData']
>[0] {
  const parsed = JSON.parse(payload) as {
    domain: Record<string, unknown>;
    types: Record<string, { name: string; type: string }[]>;
    primaryType: string;
    message: Record<string, unknown>;
  };

  // 実物のウォレットは `types` の `EIP712Domain` からドメインを符号化する。
  // 欠けていると別のドメインで署名され、コントラクトが署名を拒む。
  // 疑似の実装でも同じ要求を課し、この取り違えをテストで捕まえる。
  if (parsed.types['EIP712Domain'] === undefined) {
    throw new Error('types に EIP712Domain がありません');
  }

  const domainFields = parsed.types['EIP712Domain'].map((field) => field.name).sort();
  const actualFields = Object.keys(parsed.domain).sort();
  if (JSON.stringify(domainFields) !== JSON.stringify(actualFields)) {
    throw new Error('EIP712Domain の項目がドメインの内容と一致しません');
  }

  const { EIP712Domain: _domainType, ...signedTypes } = parsed.types;
  const fields = signedTypes[parsed.primaryType] ?? [];
  const message: Record<string, unknown> = { ...parsed.message };

  for (const field of fields) {
    if (field.type.startsWith('uint') || field.type.startsWith('int')) {
      message[field.name] = BigInt(message[field.name] as string | number);
    }
  }

  return {
    domain: parsed.domain,
    types: signedTypes,
    primaryType: parsed.primaryType,
    message,
  } as Parameters<ReturnType<typeof privateKeyToAccount>['signTypedData']>[0];
}
