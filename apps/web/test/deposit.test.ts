import { describe, expect, it, vi } from 'vitest';
import { decodeFunctionData, parseSignature } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { GATEWAY_WALLET_ABI } from '@openbook/shared';

import { buildDepositAuthorization, deposit } from '../src/deposit.js';
import { GATEWAY_WALLET, PAYMENT_ASSET } from '../src/config.js';
import { createWalletStub, TEST_PRIVATE_KEY } from './support/wallet-stub.js';

/**
 * 預け入れの確認。
 *
 * 事前に使用枠を与えるトランザクションを要さず、署名 1 回とトランザクション
 * 1 回で済ませる。署名は資産自身のドメインの `ReceiveWithAuthorization` で、
 * 受取先を取次のコントラクトに固定するため、この署名は取次経由でしか使えない。
 * 詳細は design.md の決定 9 を参照。
 */

const account = privateKeyToAccount(TEST_PRIVATE_KEY);

describe('預け入れの署名の組み立て', () => {
  it('署名のドメインが資産自身のものである', () => {
    const built = buildDepositAuthorization(account.address, 100000n, () => 1_789_000_000_000);

    expect(built.domain).toEqual({
      name: 'USDC',
      version: '2',
      chainId: 5042002,
      verifyingContract: PAYMENT_ASSET,
    });
  });

  it('受取先が取次のコントラクトである', () => {
    const built = buildDepositAuthorization(account.address, 100000n, () => 1_789_000_000_000);

    // receiveWithAuthorization は to == msg.sender を要求するため、この署名は
    // 取次のコントラクト経由でしか実行できない。
    expect(built.authorization.to).toBe(GATEWAY_WALLET);
    expect(built.primaryType).toBe('ReceiveWithAuthorization');
  });

  it('nonce がランダムで、要求ごとに変わる', () => {
    const first = buildDepositAuthorization(account.address, 100000n, () => 1_789_000_000_000);
    const second = buildDepositAuthorization(account.address, 100000n, () => 1_789_000_000_000);

    expect(first.authorization.nonce).not.toBe(second.authorization.nonce);
    expect(first.authorization.nonce).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('額を利用者が指定できる', () => {
    const built = buildDepositAuthorization(account.address, 2_500_000n, () => 1_789_000_000_000);

    expect(built.authorization.value).toBe('2500000');
  });
});

describe('預け入れの実行', () => {
  /** 残高が 1 回目の確認の後に増える照会。反映の待機を再現する。 */
  function balanceThatArrives(before: bigint, after: bigint, arrivesOnCall: number) {
    let calls = 0;
    return vi.fn(async () => {
      calls += 1;
      return calls >= arrivesOnCall ? after : before;
    });
  }

  it('署名 1 回とトランザクション 1 回で完了する', async () => {
    const wallet = createWalletStub({ chainId: 5042002 });
    const seen: string[] = [];
    const watching = {
      ...wallet,
      async request(request: { method: string; params?: unknown[] }) {
        seen.push(request.method);
        return wallet.request(request);
      },
    };

    await deposit(100000n, {
      ethereum: watching,
      address: account.address,
      readDeposit: balanceThatArrives(0n, 100000n, 2),
      waitMs: 0,
    });

    // 使用枠を与える要求は送らない。
    expect(seen.filter((m) => m === 'eth_signTypedData_v4')).toHaveLength(1);
    expect(seen.filter((m) => m === 'eth_sendTransaction')).toHaveLength(1);
    expect(wallet.sent).toHaveLength(1);
  });

  it('送るのは取次のコントラクトへの預け入れである', async () => {
    const wallet = createWalletStub({ chainId: 5042002 });

    await deposit(100000n, {
      ethereum: wallet,
      address: account.address,
      readDeposit: balanceThatArrives(0n, 100000n, 2),
      waitMs: 0,
    });

    const sent = wallet.sent[0];
    expect(sent?.to?.toLowerCase()).toBe(GATEWAY_WALLET.toLowerCase());

    const decoded = decodeFunctionData({ abi: GATEWAY_WALLET_ABI, data: sent?.data as `0x${string}` });
    expect(decoded.functionName).toBe('depositWithAuthorization');
    expect(decoded.args?.[0]).toBe(PAYMENT_ASSET);
    expect(decoded.args?.[2]).toBe(100000n);
  });

  it('送る署名が局所アカウントの署名と一致する', async () => {
    const wallet = createWalletStub({ chainId: 5042002 });
    const built = buildDepositAuthorization(account.address, 100000n, () => 1_789_000_000_000);

    await deposit(100000n, {
      ethereum: wallet,
      address: account.address,
      readDeposit: balanceThatArrives(0n, 100000n, 2),
      waitMs: 0,
      build: () => built,
    });

    const decoded = decodeFunctionData({
      abi: GATEWAY_WALLET_ABI,
      data: wallet.sent[0]?.data as `0x${string}`,
    });

    const expected = parseSignature(
      await account.signTypedData({
        domain: built.domain,
        types: built.types,
        primaryType: 'ReceiveWithAuthorization',
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

    expect(decoded.args?.[6]).toBe(Number(expected.v));
    expect(decoded.args?.[7]).toBe(expected.r);
    expect(decoded.args?.[8]).toBe(expected.s);
  });
});

describe('反映の待機', () => {
  it('残高へ反映されるまで待つ', async () => {
    const wallet = createWalletStub({ chainId: 5042002 });
    const stages: string[] = [];
    let calls = 0;

    await deposit(100000n, {
      ethereum: wallet,
      address: account.address,
      readDeposit: async () => {
        calls += 1;
        // 3 回目の確認で反映される。
        return calls >= 3 ? 100000n : 0n;
      },
      waitMs: 0,
      onStage: (stage) => stages.push(stage),
    });

    expect(stages).toEqual(['signing', 'sending', 'waiting', 'done']);
    expect(calls).toBeGreaterThanOrEqual(3);
  });

  it('反映されなければ完了として示さない', async () => {
    const wallet = createWalletStub({ chainId: 5042002 });
    const stages: string[] = [];

    const result = await deposit(100000n, {
      ethereum: wallet,
      address: account.address,
      // いつまでも反映されない。
      readDeposit: async () => 0n,
      waitMs: 0,
      maxAttempts: 3,
      onStage: (stage) => stages.push(stage),
    });

    expect(result.ok).toBe(false);
    expect(stages).not.toContain('done');
  });
});
