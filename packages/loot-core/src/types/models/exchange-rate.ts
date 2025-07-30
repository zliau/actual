export type ExchangeRateEntity = {
  id: string;
  from_currency: string;
  to_currency: string;
  rate: number;
  date: string;
  source?: string;
  created_at: string;
  updated_at: string;
}; 