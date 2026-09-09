import { describe, expect, it } from 'vitest';

import { equalsInConstantTime, isAuthorized } from '../src/auth.js';

describe('equalsInConstantTime', () => {
  it('一致する文字列を真と判定する', () => {
    expect(equalsInConstantTime('secret-token', 'secret-token')).toBe(true);
  });

  it('先頭のみ一致する文字列を偽と判定する', () => {
    expect(equalsInConstantTime('secret-token', 'secret-tokeX')).toBe(false);
  });

  it('長さが異なる文字列を偽と判定する', () => {
    expect(equalsInConstantTime('secret', 'secret-token')).toBe(false);
    expect(equalsInConstantTime('secret-token', 'secret')).toBe(false);
  });

  it('空文字列どうしは一致とみなす', () => {
    expect(equalsInConstantTime('', '')).toBe(true);
  });

  it('マルチバイト文字を扱える', () => {
    expect(equalsInConstantTime('トークン', 'トークン')).toBe(true);
    expect(equalsInConstantTime('トークン', 'トークソ')).toBe(false);
  });
});

describe('isAuthorized', () => {
  it('正しい Bearer トークンを受け入れる', () => {
    expect(isAuthorized('Bearer abc123', 'abc123')).toBe(true);
  });

  it('ヘッダがない場合は拒否する', () => {
    expect(isAuthorized(undefined, 'abc123')).toBe(false);
  });

  it('Bearer 以外のスキームは拒否する', () => {
    expect(isAuthorized('Basic abc123', 'abc123')).toBe(false);
  });

  it('期待値が未設定の場合は拒否する', () => {
    expect(isAuthorized('Bearer abc123', undefined)).toBe(false);
    expect(isAuthorized('Bearer ', '')).toBe(false);
  });

  it('誤ったトークンは拒否する', () => {
    expect(isAuthorized('Bearer wrong', 'abc123')).toBe(false);
  });
});
