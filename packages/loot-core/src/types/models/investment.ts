export type SecurityExchange = 'US' | 'TSX';

export type SecurityEntity = {
  // Comes from the exchange and symbol, like `TSX-RY`
  id: string;
  symbol: string;
  exchange: SecurityExchange;
  name: string | null;
  currency: string;
  tombstone?: boolean;
};

export type SecurityPriceSource = 'api' | 'manual';

export type SecurityPriceEntity = {
  id: string;
  security: SecurityEntity['id'];
  date: string;
  // The price as traded that day, in whole units of the security's currency
  close: number;
  source: SecurityPriceSource;
  tombstone?: boolean;
};

export type TradeType = 'buy' | 'sell';

export type TradeEntity = {
  id: string;
  account: string;
  security: SecurityEntity['id'];
  date: string;
  type: TradeType;
  quantity: number;
  // Per share, in whole units of the security's currency
  price: number;
  // In cents, like transaction amounts
  fee: number;
  // The transaction that moves the trade's cash in the account
  transaction_id: string | null;
  tombstone?: boolean;
};

export type Holding = {
  security: SecurityEntity['id'];
  symbol: string;
  name: string | null;
  currency: string;
  // 0 once everything is sold, while the realized gain still counts
  quantity: number;
  // Per share, in whole units of the security's currency, including fees
  averageCost: number;
  // In cents, like the other amounts below
  costBasis: number;
  // Per share, in whole units of the security's currency
  price: number;
  // The day of the price: of a stored close or of the latest trade
  priceDate: string;
  marketValue: number;
  unrealizedGain: number;
  // Of the cost basis, so 0.1 is a 10% gain
  unrealizedGainRatio: number;
  realizedGain: number;
};

export type AccountHoldings = {
  holdings: Holding[];
  // The account's transactions added up, in cents
  cash: number;
};
