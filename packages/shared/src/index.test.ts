import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION } from './index.js';

describe('packages/shared', () => {
  it('スキーマバージョンを公開する', () => {
    expect(SCHEMA_VERSION).toBe(1);
  });
});
