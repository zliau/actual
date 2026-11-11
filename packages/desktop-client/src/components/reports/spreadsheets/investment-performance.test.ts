import type {
  InvestmentPerformance,
  PerformancePoint,
} from '@actual-app/core/types/models';
import { describe, expect, it } from 'vitest';

import {
  getPerformanceRows,
  getPerformanceSummary,
} from './investment-performance';

const point = (growth: number, gain = 0): PerformancePoint => ({
  value: 0,
  gain,
  growth,
});

// Up 10%, then 20% on that, then down 50%. B is bought in March.
const performance: InvestmentPerformance = {
  securities: [
    { id: 'A', symbol: 'A' },
    { id: 'B', symbol: 'B' },
  ],
  months: [
    {
      month: '2026-01',
      date: '2026-01-31',
      total: point(1.1, 100),
      securities: { A: point(1.1) },
    },
    {
      month: '2026-02',
      date: '2026-02-28',
      total: point(1.32, 220),
      securities: { A: point(1.32) },
    },
    {
      month: '2026-03',
      date: '2026-03-31',
      total: point(0.66, -500),
      securities: { A: point(0.66), B: point(1.5) },
    },
  ],
};

describe('getPerformanceRows', () => {
  it('measures from the start of the range', () => {
    const rows = getPerformanceRows(
      performance,
      '2026-02',
      '2026-03',
      undefined,
    );
    expect(rows.map(({ label }) => label)).toEqual([
      'Jan 26',
      'Feb 26',
      'Mar 26',
    ]);
    // The month before the range leads at 0%
    expect(rows[0]).toMatchObject({ total: 0, securities: { A: 0 } });
    expect(rows[1].total).toBeCloseTo(0.2);
    expect(rows[2].total).toBeCloseTo(-0.4);
    // B wasn't held at the start, so it counts from when it was bought
    expect(rows[2].securities.B).toBeCloseTo(0.5);
  });

  it('starts from the first trade when the range does', () => {
    const rows = getPerformanceRows(
      performance,
      '2026-01',
      '2026-02',
      undefined,
    );
    expect(rows.map(({ total }) => total)).toEqual([
      expect.closeTo(0.1),
      expect.closeTo(0.32),
    ]);
  });
});

describe('getPerformanceSummary', () => {
  it('gives the return and gain over the range', () => {
    const summary = getPerformanceSummary(performance, '2026-02', '2026-03');
    expect(summary?.ratio).toBeCloseTo(-0.4);
    expect(summary?.gain).toBe(-280);
  });

  it('has nothing for a range before the first trade', () => {
    expect(getPerformanceSummary(performance, '2025-01', '2025-12')).toBeNull();
  });
});
