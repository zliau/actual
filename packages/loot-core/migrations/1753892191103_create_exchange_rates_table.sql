CREATE TABLE exchange_rates (
  id TEXT PRIMARY KEY,
  from_currency TEXT,
  to_currency TEXT,
  rate REAL,
  date TEXT
);

-- Create a unique index on the combination of currencies and date
CREATE UNIQUE INDEX idx_exchange_rates_unique ON exchange_rates(from_currency, to_currency, date); 