import { describe, expect, it } from 'vitest';

import {
  resolveWorkspaceFilter,
  loadAdmobConfig,
  loadCostConfig,
  type AdmobConfigInput,
  type CostConfigInput,
} from '../../src/sources/config.js';

const COMPLETE: CostConfigInput = {
  CLAUDE_ADMIN_KEY: 'sk-ant-admin01-x',
  CLAUDE_WORKSPACE: 'default',
  CLOUDFLARE_BILLING_TOKEN: 'cf-token',
  CLOUDFLARE_ACCOUNT_ID: 'acc-1',
  RESEND_API_KEY: 're_x',
  RESEND_PLAN: 'free',
  SUPABASE_PAT: 'sbp_x',
  SUPABASE_ORG_SLUG: 'org-1',
};

describe('resolveWorkspaceFilter', () => {
  it('既定ワークスペースの指定は応答上の空値に対応付けられる', () => {
    expect(resolveWorkspaceFilter('default')).toEqual({ kind: 'default' });
  });

  it('ワークスペース ID の指定はその ID に対応付けられる', () => {
    expect(resolveWorkspaceFilter('wrkspc_123')).toEqual({
      kind: 'id',
      workspaceId: 'wrkspc_123',
    });
  });

  it('設定値そのものが無い場合は未設定として区別される', () => {
    expect(resolveWorkspaceFilter(undefined)).toEqual({ kind: 'unset' });
    expect(resolveWorkspaceFilter('')).toEqual({ kind: 'unset' });
  });

  it('既定ワークスペースの指定と未設定は異なる結果になる', () => {
    expect(resolveWorkspaceFilter('default')).not.toEqual(resolveWorkspaceFilter(undefined));
  });
});

describe('loadCostConfig', () => {
  it('すべて揃っていれば設定を返す', () => {
    const config = loadCostConfig(COMPLETE);

    expect(config.claude).toEqual({
      adminKey: 'sk-ant-admin01-x',
      workspace: { kind: 'default' },
    });
    expect(config.cloudflare).toEqual({ token: 'cf-token', accountId: 'acc-1' });
    expect(config.resend).toEqual({ apiKey: 're_x', plan: 'free' });
    expect(config.supabase).toEqual({ pat: 'sbp_x', orgSlug: 'org-1' });
  });

  it('認証情報が欠けている提供元は設定を持たない', () => {
    const { CLAUDE_ADMIN_KEY: _omit, ...rest } = COMPLETE;

    expect(loadCostConfig(rest).claude).toBeUndefined();
  });

  it('対象ワークスペースが未設定なら Claude の設定を持たない', () => {
    const { CLAUDE_WORKSPACE: _omit, ...rest } = COMPLETE;

    expect(loadCostConfig(rest).claude).toBeUndefined();
  });

  it('欠けている理由を提供元ごとに説明する', () => {
    const config = loadCostConfig({ CLAUDE_ADMIN_KEY: 'sk-ant-admin01-x' });

    expect(config.missing).toEqual([
      { source: 'claude', reason: expect.stringContaining('CLAUDE_WORKSPACE') },
      { source: 'cloudflare', reason: expect.any(String) },
      { source: 'resend', reason: expect.any(String) },
      { source: 'supabase', reason: expect.any(String) },
    ]);
  });

  it('無料プラン以外の宣言も受け入れる', () => {
    const config = loadCostConfig({ ...COMPLETE, RESEND_PLAN: 'pro:20.00' });

    expect(config.resend).toEqual({ apiKey: 're_x', plan: 'pro', monthlyAmountUsd: '20.00' });
  });
});

const ADMOB_COMPLETE: AdmobConfigInput = {
  ADMOB_CLIENT_ID: 'client-1',
  ADMOB_CLIENT_SECRET: 'secret-1',
  ADMOB_REFRESH_TOKEN: 'refresh-1',
  ADMOB_PUBLISHER_ID: 'pub-1',
  ADMOB_APP_ID: 'ca-app-pub-1~2',
};

describe('loadAdmobConfig', () => {
  it('5 つがそろっていれば設定を返す', () => {
    const config = loadAdmobConfig(ADMOB_COMPLETE);

    expect(config.admob).toEqual({
      clientId: 'client-1',
      clientSecret: 'secret-1',
      refreshToken: 'refresh-1',
      publisherId: 'pub-1',
      appId: 'ca-app-pub-1~2',
    });
    expect(config.missing).toEqual([]);
  });

  it('いずれかが未設定なら理由つきで欠ける', () => {
    const config = loadAdmobConfig({ ...ADMOB_COMPLETE, ADMOB_APP_ID: undefined });

    expect(config.admob).toBeUndefined();
    expect(config.missing).toEqual([
      { source: 'admob', reason: expect.stringMatching(/ADMOB_APP_ID/) },
    ]);
  });

  it('アプリ ID がパブリッシャー ID に属さなければ設定誤りとして欠ける', () => {
    const config = loadAdmobConfig({ ...ADMOB_COMPLETE, ADMOB_APP_ID: 'ca-app-pub-9~2' });

    expect(config.admob).toBeUndefined();
    expect(config.missing).toEqual([
      { source: 'admob', reason: expect.stringMatching(/パブリッシャー ID/) },
    ]);
  });
});
