BEGIN TRANSACTION;

CREATE TABLE account_groups
  (id TEXT PRIMARY KEY,
   name TEXT,
   sort_order REAL,
   tombstone INTEGER DEFAULT 0);

ALTER TABLE accounts ADD COLUMN account_group TEXT;

DROP VIEW IF EXISTS v_accounts;
CREATE VIEW v_accounts AS
SELECT
  id,
  name,
  account_group AS "group",
  sort_order,
  tombstone
FROM accounts;

COMMIT;
