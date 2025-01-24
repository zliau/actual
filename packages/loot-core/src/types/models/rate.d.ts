export interface RateEntity {
  id: string;
  date: string;
  from_currency: string;
  to_currency: string;
  rate: number;
}

export type SynthExchangeRate = {
  rates: {
    [key: string]: number;
  };
};
