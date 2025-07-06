import { describe, it, expect } from 'vitest';
import type { DbAccount } from './index';

describe('DbAccount currency field', () => {
  it('should allow currency field to be set', () => {
    const account: DbAccount = {
      id: 'test-account',
      name: 'Test Account',
      offbudget: 0,
      closed: 0,
      tombstone: 0,
      sort_order: 1,
      currency: 'USD',
    };

    expect(account.currency).toBe('USD');
  });

  it('should allow currency field to be null', () => {
    const account: DbAccount = {
      id: 'test-account',
      name: 'Test Account',
      offbudget: 0,
      closed: 0,
      tombstone: 0,
      sort_order: 1,
      currency: null,
    };

    expect(account.currency).toBeNull();
  });

  it('should allow currency field to be undefined', () => {
    const account: DbAccount = {
      id: 'test-account',
      name: 'Test Account',
      offbudget: 0,
      closed: 0,
      tombstone: 0,
      sort_order: 1,
    };

    expect(account.currency).toBeUndefined();
  });
}); 