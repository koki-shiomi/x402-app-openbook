import { describe, expect, it, vi } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';

import { buildAuthorization, signPayment, toPaymentHeader } from '../src/payment.js';
import type { PaymentTerms } from '../src/api.js';
import { createWalletStub, TEST_PRIVATE_KEY } from './support/wallet-stub.js';

/**
 * 署名の組み立ての確認。
 *
 * 決済の取次は、自身が広告した EIP-712 のドメインでの署名しか受理しない。
 * ドメインは API が支払いの条件として返すため、画面に固定で持たない。
 * 詳細は design.md の決定 3 を参照。
 */

const account = privateKeyToAccount(TEST_PRIVATE_KEY);

const TERMS: PaymentTerms = {
  network: 'eip155:5042002',
  amount: '100000',
  asset: '0x3600000000000000000000000000000000000000',
  payTo: '0xd77dd307A9E395fB2680011deeD994A27cf70d4b',
  maxTimeoutSeconds: 605100,
  extra: {
    name: 'GatewayWalletBatched',
    version: '1',
    verifyingContract: '0x0077777d7eba4688bdef3e311b846f25870a19b9',
    minValiditySeconds: 604800,
  },
};

describe('支払いの組み立て', () => {
  it('EIP-712 のドメインが条件の extra から取られる', () => {
    const { domain } = buildAuthorization(TERMS, account.address, () => 1_789_000_000_000);

    expect(domain).toEqual({
      name: 'GatewayWalletBatched',
      version: '1',
      chainId: 5042002,
      verifyingContract: '0x0077777d7eba4688bdef3e311b846f25870a19b9',
    });
  });

  it('資産のアドレスをドメインに用いない', () => {
    // @x402/evm のクライアントはここに資産のアドレスを固定で用いるため受理されない。
    const { domain } = buildAuthorization(TERMS, account.address, () => 1_789_000_000_000);

    expect(domain.verifyingContract).not.toBe(TERMS.asset);
  });

  it('有効期限が条件の maxTimeoutSeconds から算出される', () => {
    const now = 1_789_000_000_000;
    const { authorization } = buildAuthorization(TERMS, account.address, () => now);

    expect(authorization.validBefore).toBe(
      String(Math.floor(now / 1000) + TERMS.maxTimeoutSeconds),
    );
    expect(authorization.validAfter).toBe('0');
  });

  it('有効期間が取次の下限を満たす', () => {
    const now = 1_789_000_000_000;
    const { authorization } = buildAuthorization(TERMS, account.address, () => now);

    const validity = Number(authorization.validBefore) - Math.floor(now / 1000);
    expect(validity).toBeGreaterThanOrEqual(Number(TERMS.extra['minValiditySeconds']));
  });

  it('支払う相手と金額が条件のとおりである', () => {
    const { authorization } = buildAuthorization(TERMS, account.address, () => 1_789_000_000_000);

    expect(authorization.from).toBe(account.address);
    expect(authorization.to).toBe(TERMS.payTo);
    expect(authorization.value).toBe('100000');
  });

  it('nonce が要求ごとに変わる', () => {
    const first = buildAuthorization(TERMS, account.address, () => 1_789_000_000_000);
    const second = buildAuthorization(TERMS, account.address, () => 1_789_000_000_000);

    expect(first.authorization.nonce).not.toBe(second.authorization.nonce);
    expect(first.authorization.nonce).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('ウォレットで署名でき、局所アカウントの署名と一致する', async () => {
    const wallet = createWalletStub({ chainId: 5042002 });
    const built = buildAuthorization(TERMS, account.address, () => 1_789_000_000_000);

    const signature = await signPayment(wallet, built);

    expect(signature).toBe(
      await account.signTypedData({
        domain: built.domain,
        types: built.types,
        primaryType: 'TransferWithAuthorization',
        message: {
          from: built.authorization.from as `0x${string}`,
          to: built.authorization.to as `0x${string}`,
          value: BigInt(built.authorization.value),
          validAfter: BigInt(built.authorization.validAfter),
          validBefore: BigInt(built.authorization.validBefore),
          nonce: built.authorization.nonce as `0x${string}`,
        },
      }),
    );
  });

  it('秘密鍵の入力を求めない', async () => {
    const wallet = createWalletStub({ chainId: 5042002 });
    const seen: string[] = [];
    const watching = {
      ...wallet,
      async request(request: { method: string; params?: unknown[] }) {
        seen.push(request.method);
        return wallet.request(request);
      },
    };

    await signPayment(watching, buildAuthorization(TERMS, account.address, () => 1_789_000_000_000));

    // 署名はウォレットの中で行われ、鍵そのものを扱う口は呼ばない。
    expect(seen).toEqual(['eth_signTypedData_v4']);
  });

  it('支払いのヘッダに条件と署名が含まれる', async () => {
    const wallet = createWalletStub({ chainId: 5042002 });
    const built = buildAuthorization(TERMS, account.address, () => 1_789_000_000_000);
    const signature = await signPayment(wallet, built);

    const header = toPaymentHeader(TERMS, { url: 'https://example.invalid' }, built, signature);
    const decoded = JSON.parse(atob(header)) as {
      x402Version: number;
      payload: { authorization: unknown; signature: string };
      accepted: PaymentTerms;
    };

    expect(decoded.x402Version).toBe(2);
    expect(decoded.payload.signature).toBe(signature);
    expect(decoded.payload.authorization).toEqual(built.authorization);
    expect(decoded.accepted).toEqual(TERMS);
  });
});
