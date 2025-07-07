CREATE VIEW IF NOT EXISTS transactions_with_original_amounts AS
SELECT 
  t.id,
  t.isParent,
  t.isChild,
  t.date,
  t.acct,
  t.amount,
  t.sort_order,
  t.parent_id,
  t.category,
  t.description,
  t.notes,
  t.financial_id,
  t.error,
  t.imported_description,
  t.transferred_id,
  t.schedule,
  t.starting_balance_flag,
  t.tombstone,
  t.cleared,
  t.reconciled,
  a.currency as account_currency,
  CASE 
    WHEN a.currency IS NULL OR a.currency = '' THEN t.amount
    ELSE t.amount / COALESCE(er.rate, 1.0)
  END as original_amount
FROM transactions t
LEFT JOIN accounts a ON t.acct = a.id
LEFT JOIN exchange_rates er ON 
  er.from_currency = a.currency 
  AND er.to_currency = (SELECT value FROM preferences WHERE id = 'defaultCurrencyCode')
  AND er.date = date(t.date, 'unixepoch')
WHERE t.tombstone = 0; 