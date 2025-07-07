import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getExchangeRate, convertAmount, getOriginalAmount } from './app';

// Mock the database
vi.mock('../db', () => ({
  first: vi.fn(),
  runQuery: vi.fn(),
}));

// Mock fetch
global.fetch = vi.fn();

describe('Exchange Rate Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 1.0 for same currency', async () => {
    const rate = await getExchangeRate('USD', 'USD', '2024-01-01');
    expect(rate).toBe(1.0);
  });

  it('should convert amount correctly', async () => {
    const converted = await convertAmount(100, 'USD', 'USD', '2024-01-01');
    expect(converted).toBe(100);
  });

  it('should get original amount correctly', async () => {
    const original = await getOriginalAmount(100, 'USD', 'USD', '2024-01-01');
    expect(original).toBe(100);
  });

  it('should handle API errors gracefully', async () => {
    (global.fetch as any).mockRejectedValue(new Error('API Error'));
    
    await expect(getExchangeRate('USD', 'EUR', '2024-01-01')).rejects.toThrow(
      'Failed to get exchange rate for USD to EUR'
    );
  });
}); 