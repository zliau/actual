BEGIN TRANSACTION;

-- Create exchange_rates table to store historical exchange rates
CREATE TABLE exchange_rates (
  id TEXT PRIMARY KEY,
  from_currency TEXT NOT NULL,
  to_currency TEXT NOT NULL,
  rate REAL NOT NULL,
  date TEXT NOT NULL,
  source TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(from_currency, to_currency, date)
);

-- Create index for efficient lookups
CREATE INDEX idx_exchange_rates_lookup ON exchange_rates(from_currency, to_currency, date);

COMMIT; 