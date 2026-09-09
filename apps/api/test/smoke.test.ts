import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION } from '@openbook/shared';

describe('apps/api', () => {
  it('共有パッケージを参照できる', () => {
    expect(SCHEMA_VERSION).toBe(1);
  });
});
