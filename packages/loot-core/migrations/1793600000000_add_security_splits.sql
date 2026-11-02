BEGIN TRANSACTION;

CREATE TABLE security_splits
  (id TEXT PRIMARY KEY,
   security TEXT,
   date INTEGER,
   ratio REAL,
   status TEXT,
   tombstone INTEGER DEFAULT 0);

CREATE INDEX security_splits_security_date ON security_splits (security, date);

COMMIT;
