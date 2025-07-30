BEGIN TRANSACTION;

-- Drop existing views
DROP VIEW IF EXISTS v_transactions_layer2;
DROP VIEW IF EXISTS v_transactions_layer1;
DROP VIEW IF EXISTS v_transactions;

-- Create updated v_transactions_layer2 with currency conversion
CREATE VIEW v_transactions_layer2 AS
SELECT
  t.id AS id,
  t.isParent AS is_parent,
  t.isChild AS is_child,
  t.acct AS account,
  CASE WHEN t.isChild = 0 THEN NULL ELSE t.parent_id END AS parent_id,
  CASE WHEN t.isParent = 1 THEN NULL ELSE cm.transferId END AS category,
  pm.targetId AS payee,
  t.imported_description AS imported_payee,
  -- amount: converted to base currency (for reports/spreadsheets)
  CASE 
    WHEN a.currency IS NULL OR a.currency = '' THEN IFNULL(t.amount, 0)
    WHEN a.currency = COALESCE((SELECT value FROM preferences WHERE id = 'defaultCurrencyCode' LIMIT 1), 'USD') THEN IFNULL(t.amount, 0)
    ELSE COALESCE(
      ROUND(IFNULL(t.amount, 0) * er.rate),
      IFNULL(t.amount, 0)  -- Fallback to original amount if no exchange rate
    )
  END AS amount,
  -- currency_amount: original amount stored in database (in account's currency)
  IFNULL(t.amount, 0) AS currency_amount,
  t.notes AS notes,
  t.date AS date,
  t.financial_id AS imported_id,
  t.error AS error,
  t.starting_balance_flag AS starting_balance_flag,
  t.transferred_id AS transfer_id,
  t.sort_order AS sort_order,
  t.cleared AS cleared,
  t.tombstone AS tombstone
FROM transactions t
LEFT JOIN category_mapping cm ON cm.id = t.category
LEFT JOIN payee_mapping pm ON pm.id = t.description
LEFT JOIN accounts a ON a.id = t.acct
LEFT JOIN exchange_rates er ON (
  er.from_currency = a.currency 
  AND er.to_currency = COALESCE((SELECT value FROM preferences WHERE id = 'defaultCurrencyCode' LIMIT 1), 'USD')
  AND er.date = substr(t.date, 1, 4) || '-' || substr(t.date, 5, 2) || '-' || substr(t.date, 7, 2)
)
WHERE
  t.date IS NOT NULL AND
  t.acct IS NOT NULL;

-- Create updated v_transactions_layer1
CREATE VIEW v_transactions_layer1 AS
SELECT t.* FROM v_transactions_layer2 t
LEFT JOIN transactions t2 ON (t.is_child = 1 AND t2.id = t.parent_id)
WHERE IFNULL(t.tombstone, 0) = 0 AND IFNULL(t2.tombstone, 0) = 0;

-- Create updated v_transactions
CREATE VIEW v_transactions AS
SELECT t.* FROM v_transactions_layer1 t
ORDER BY t.date desc, t.starting_balance_flag, t.sort_order desc, t.id;

COMMIT; 