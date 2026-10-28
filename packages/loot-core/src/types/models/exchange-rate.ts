export type ExchangeRateSource = 'api' | 'manual';

export type ExchangeRateEntity = {
  id: string;
  date: string;
  from_currency: string;
  to_currency: string;
  rate: number;
  source: ExchangeRateSource;
  tombstone?: boolean;
};
