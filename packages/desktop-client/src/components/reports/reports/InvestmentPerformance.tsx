import { useParams } from 'react-router';

import type { InvestmentPerformanceWidget } from '@actual-app/core/types/models';

import { LoadingIndicator } from '#components/reports/LoadingIndicator';
import { useDashboardWidget } from '#hooks/useDashboardWidget';

import { InvestmentPerformanceContent } from './InvestmentPerformanceContent';

export function InvestmentPerformance() {
  const params = useParams();
  const { data: widget, isLoading } =
    useDashboardWidget<InvestmentPerformanceWidget>({
      id: params.id,
      type: 'investment-performance-card',
    });

  if (isLoading) {
    return <LoadingIndicator />;
  }

  return <InvestmentPerformanceContent widget={widget} />;
}
