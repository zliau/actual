BEGIN TRANSACTION;

ALTER TABLE accounts ADD COLUMN currency TEXT DEFAULT NULL;

CREATE TABLE exchange_rates
  (id TEXT PRIMARY KEY,
   date INTEGER,
   from_currency TEXT,
   to_currency TEXT,
   rate REAL,
   source TEXT,
   tombstone INTEGER DEFAULT 0);

CREATE INDEX exchange_rates_pair_date ON exchange_rates (from_currency, to_currency, date);

COMMIT;
