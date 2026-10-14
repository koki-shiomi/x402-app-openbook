import { describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';

import { checkPreconditions, type PreconditionDeps } from '../src/preconditions.js';
import type { PaymentTerms } from '../src/api.js';
import { createWalletStub, TEST_PRIVATE_KEY } from './support/wallet-stub.js';

/**
 * 支払いの事前条件の確認。
 *
 * 預け入れ不足と自己送金は、いずれも署名を終えて要求を送ってから取次に拒まれる。
 * 利用者は署名の手間をかけた末に、原因の分からない失敗を受け取ることになる。
 * 署名を求める前に判定する。詳細は design.md の決定 4 を参照。
 */

const account = privateKeyToAccount(TEST_PRIVATE_KEY);

const TERMS: PaymentTerms = {
  network: 'eip155:5042',
  amount: '100000',
  asset: '0x3600000000000000000000000000000000000000',
  payTo: '0xd77dd307A9E395fB2680011deeD994A27cf70d4b',
  maxTimeoutSeconds: 605100,
  extra: {
    name: 'GatewayWalletBatched',
    version: '1',
    verifyingContract: '0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE',
  },
};

/** 預け入れ残高を固定で返す照会。 */
function depositOf(balance: bigint): PreconditionDeps['readDeposit'] {
  return async () => balance;
}

/** 既定の依存を組み立てる。 */
function depsWith(overrides: Partial<PreconditionDeps> = {}): PreconditionDeps {
  return {
    ethereum: createWalletStub({ chainId: 5042 }),
    readDeposit: depositOf(500000n),
    ...overrides,
  };
}

describe('支払いの事前条件', () => {
  it('すべて満たせば支払いへ進める', async () => {
    const result = await checkPreconditions(TERMS, depsWith());

    expect(result.ok).toBe(true);
  });

  it('未接続なら接続が必要である旨を示す', async () => {
    const result = await checkPreconditions(
      TERMS,
      depsWith({ ethereum: createWalletStub({ chainId: 5042, connected: false }) }),
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('not-connected');
    expect(result.ok === false && result.message).toContain('接続');
  });

  it('チェーンが異なれば切り替えが必要である旨を示す', async () => {
    const result = await checkPreconditions(
      TERMS,
      depsWith({ ethereum: createWalletStub({ chainId: 1 }) }),
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('wrong-chain');
    expect(result.ok === false && result.message).toContain('切り替え');
  });

  it('チェーンが異なる場合、手動で追加するための値を示す', async () => {
    const result = await checkPreconditions(
      TERMS,
      depsWith({ ethereum: createWalletStub({ chainId: 1 }) }),
    );

    expect(result.ok === false && result.details).toEqual(
      expect.objectContaining({ chainId: 5042 }),
    );
  });

  it('支払い元と受取先が同一なら別のアドレスが必要である旨を示す', async () => {
    const result = await checkPreconditions(
      { ...TERMS, payTo: account.address },
      depsWith(),
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('self-transfer');
    expect(result.ok === false && result.message).toContain('別のアドレス');
  });

  it('預け入れが価格に満たなければ預け入れ先を示す', async () => {
    const result = await checkPreconditions(TERMS, depsWith({ readDeposit: depositOf(99999n) }));

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('insufficient-deposit');
    expect(result.ok === false && result.message).toContain('預け入れ');
    expect(result.ok === false && result.details).toEqual(
      expect.objectContaining({ gatewayWallet: '0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE' }),
    );
  });

  it('預け入れが価格ちょうどなら進める', async () => {
    const result = await checkPreconditions(TERMS, depsWith({ readDeposit: depositOf(100000n) }));

    expect(result.ok).toBe(true);
  });

  it('判定は署名を求めない', async () => {
    let signed = false;
    const wallet = createWalletStub({ chainId: 5042 });
    const watching = {
      ...wallet,
      async request(request: { method: string; params?: unknown[] }) {
        if (request.method === 'eth_signTypedData_v4') {
          signed = true;
        }
        return wallet.request(request);
      },
    };

    await checkPreconditions(TERMS, depsWith({ ethereum: watching, readDeposit: depositOf(0n) }));

    expect(signed).toBe(false);
  });
});
