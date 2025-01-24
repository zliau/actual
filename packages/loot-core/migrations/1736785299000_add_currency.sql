BEGIN TRANSACTION;

ALTER TABLE accounts ADD COLUMN currency TEXT;

CREATE TABLE rates (
  id TEXT PRIMARY KEY,
  from_currency TEXT,
  to_currency TEXT,
  rate REAL,
  date INTEGER,
  UNIQUE(from_currency, to_currency, date)
);

COMMIT;
