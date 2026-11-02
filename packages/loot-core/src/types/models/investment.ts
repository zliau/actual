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

export type SecuritySplitStatus = 'suggested' | 'confirmed' | 'dismissed';

export type SecuritySplitEntity = {
  id: string;
  security: SecurityEntity['id'];
  date: string;
  // New shares for each old one: a 4-for-1 split is 4, a 1-for-10 one is 0.1
  ratio: number;
  // Only confirmed splits change holdings
  status: SecuritySplitStatus;
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
  // The account's transactions added up without its market value, in cents
  cash: number;
  // Splits a provider reported for what the account holds, waiting for an answer
  suggestedSplits: Array<SecuritySplitEntity & { symbol: string }>;
};

export type SecuritySearchResult = {
  symbol: string;
  name: string;
};

// A close to suggest as a trade's price, from the day asked for or the last
// trading day before it. `no-close` means none was found for those days.
export type SecurityCloseResult =
  | { date: string; close: number }
  | {
      error:
        | SecurityProviderFailure
        | 'no-close'
        | 'no-server'
        | 'unauthorized';
    };

export type SecurityProviderFailure =
  | 'not-configured'
  | 'invalid-key'
  | 'rate-limited'
  | 'unknown-symbol'
  | 'prices-unavailable';

export type UpdateSecurityPricesResult =
  | { error: 'unauthorized' | 'no-server' }
  | {
      // How many closes were stored
      count: number;
      // Exchanges that couldn't be asked, and why
      problems: Partial<Record<SecurityExchange, SecurityProviderFailure>>;
      // Symbols the provider had nothing for
      unavailable: string[];
    };
