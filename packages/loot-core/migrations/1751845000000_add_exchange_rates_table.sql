BEGIN TRANSACTION;

CREATE TABLE exchange_rates (
  id TEXT PRIMARY KEY,
  from_currency TEXT NOT NULL,
  to_currency TEXT NOT NULL,
  rate REAL NOT NULL,
  date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(from_currency, to_currency, date)
);

CREATE INDEX idx_exchange_rates_lookup ON exchange_rates(from_currency, to_currency, date);

COMMIT; 