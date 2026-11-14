BEGIN TRANSACTION;

CREATE TABLE dividend_suggestions
  (id TEXT PRIMARY KEY,
   account TEXT,
   security TEXT,
   date INTEGER,
   per_share REAL,
   status TEXT,
   tombstone INTEGER DEFAULT 0);

CREATE INDEX dividend_suggestions_account ON dividend_suggestions (account, status);

COMMIT;
