BEGIN TRANSACTION;

ALTER TABLE accounts ADD COLUMN investment INTEGER DEFAULT 0;

CREATE TABLE securities
  (id TEXT PRIMARY KEY,
   symbol TEXT,
   exchange TEXT,
   name TEXT,
   currency TEXT,
   tombstone INTEGER DEFAULT 0);

CREATE TABLE security_prices
  (id TEXT PRIMARY KEY,
   security TEXT,
   date INTEGER,
   close REAL,
   source TEXT,
   tombstone INTEGER DEFAULT 0);

CREATE INDEX security_prices_security_date ON security_prices (security, date);

CREATE TABLE trades
  (id TEXT PRIMARY KEY,
   account TEXT,
   security TEXT,
   date INTEGER,
   type TEXT,
   quantity REAL,
   price REAL,
   fee INTEGER DEFAULT 0,
   transaction_id TEXT,
   tombstone INTEGER DEFAULT 0);

CREATE INDEX trades_account_security_date ON trades (account, security, date);

COMMIT;
