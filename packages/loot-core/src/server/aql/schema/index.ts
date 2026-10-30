// @ts-strict-ignore
import type { SchemaConfig } from '#server/aql/compiler';

function f(type: string, opts?: Record<string, unknown>) {
  return { type, ...opts };
}

// This is the table schema!
//
// The schema itself is the public API for querying and updating data.
// The schema config provides a lot of control over how queries are
// constructed other metadata used by the executors. The goal is to
// provide a simple interface to the app, but allow the backend to
// highly optimize how queries are run.
//
// A few notes:
//
// * `transactions` is a special table and is has a highly customized
// executor (see `executors.js`) for performace. It should mostly be
// transparent to you, but it's worth reading the comments in there if
// requirements change, especially regarding split transactions.
//
// * You should rarely change the schema and only add to it, but it is
// relatively safe to change if needed. The only problem is changing a
// public API, but that could be mitigated with an option in schema
// config to map field name for backwards compatibility.
//
// * It's important that the table names here in the schema map to the
// real tables in sqlite that are updated. Otherwise subscriptions
// might not work because the dependencies are wrong. If needed in the
// future, we can provide another option in the schema config to map a
// table name the internal table that is updated.

const MAIN_CURRENCY_SQL = `(SELECT value FROM preferences WHERE id = 'defaultCurrencyCode')`;

export const schema = {
  transactions: {
    id: f('id'),
    is_parent: f('boolean'),
    is_child: f('boolean'),
    parent_id: f('id'),
    account: f('id', { ref: 'accounts', required: true }),
    category: f('id', { ref: 'categories' }),
    amount: f('integer', { default: 0, required: true }),
    converted_amount: f('integer'),
    payee: f('id', { ref: 'payees' }),
    notes: f('string'),
    date: f('date', { required: true }),
    imported_id: f('string'),
    error: f('json'),
    imported_payee: f('string'),
    starting_balance_flag: f('boolean'),
    transfer_id: f('id'),
    sort_order: f('float', { default: () => Date.now() }),
    cleared: f('boolean', { default: true }),
    reconciled: f('boolean', { default: false }),
    tombstone: f('boolean'),
    schedule: f('id', { ref: 'schedules' }),
    raw_synced_data: f('string'),
    // subtransactions is a special field added if the table has the
    // `splits: grouped` option
  },
  payees: {
    id: f('id'),
    name: f('string', { required: true }),
    transfer_acct: f('id', { ref: 'accounts' }),
    tombstone: f('boolean'),
    favorite: f('boolean'),
    learn_categories: f('boolean'),
  },
  accounts: {
    id: f('id'),
    name: f('string', { required: true }),
    offbudget: f('boolean'),
    closed: f('boolean'),
    sort_order: f('float'),
    tombstone: f('boolean'),
    account_id: f('string'),
    official_name: f('string'),
    account_sync_source: f('string'),
    last_reconciled: f('string'),
    last_sync: f('string'),
    bank_sync_status: f('string'),
    account_group_id: f('id', { ref: 'account_groups' }),
    currency: f('string'),
    // Only in the views: the latest exchange rate from the account's currency
    // to the main currency, or 1 when they match or no rate is known.
    // Multiply balances by this to value them in the main currency.
    latest_rate: f('float'),
  },
  account_groups: {
    id: f('id'),
    name: f('string'),
    sort_order: f('float'),
    tombstone: f('boolean'),
  },
  exchange_rates: {
    id: f('id'),
    date: f('date', { required: true }),
    from_currency: f('string', { required: true }),
    to_currency: f('string', { required: true }),
    rate: f('float', { required: true }),
    source: f('string'),
    tombstone: f('boolean'),
  },
  categories: {
    id: f('id'),
    name: f('string'),
    is_income: f('boolean'),
    hidden: f('boolean'),
    group: f('id', { ref: 'category_groups' }),
    goal_def: f('string'),
    cleanup_def: f('string'),
    template_settings: f('json', { default: { source: 'notes' } }),
    sort_order: f('float'),
    tombstone: f('boolean'),
  },
  category_groups: {
    id: f('id'),
    name: f('string'),
    is_income: f('boolean'),
    hidden: f('boolean'),
    sort_order: f('float'),
    tombstone: f('boolean'),
  },
  cleanup_groups: {
    id: f('id'),
    name: f('string'),
    tombstone: f('boolean'),
  },
  schedules: {
    id: f('id'),
    name: f('string'),
    rule: f('id', { ref: 'rules', required: true }),
    next_date: f('date'),
    completed: f('boolean'),
    posts_transaction: f('boolean'),
    custom_upcoming_length: f('string'),
    tombstone: f('boolean'),
    sort_order: f('float'),

    // These are special fields that are actually pulled from the
    // underlying rule
    _payee: f('id', { ref: 'payees' }),
    _account: f('id', { ref: 'accounts' }),
    _amount: f('json/fallback'),
    _amountOp: f('string'),
    _date: f('json/fallback'),
    _conditions: f('json'),
    _actions: f('json'),
    _has_splits: f('boolean'),
  },
  rules: {
    id: f('id'),
    stage: f('string'),
    conditions_op: f('string'),
    conditions: f('json'),
    actions: f('json'),
    tombstone: f('boolean'),
  },
  notes: {
    id: f('id'),
    note: f('string'),
  },
  preferences: {
    id: f('id'),
    value: f('string'),
  },
  transaction_filters: {
    id: f('id'),
    name: f('string'),
    conditions_op: f('string'),
    conditions: f('json'),
    tombstone: f('boolean'),
  },
  custom_reports: {
    id: f('id'),
    name: f('string'),
    start_date: f('string', { default: '2023-06' }),
    end_date: f('string', { default: '2023-09' }),
    date_static: f('integer', { default: 0 }),
    date_range: f('string'),
    mode: f('string', { default: 'total' }),
    group_by: f('string', { default: 'Category' }),
    sort_by: f('string', { default: 'desc' }),
    balance_type: f('string', { default: 'Expense' }),
    show_empty: f('integer', { default: 0 }),
    show_offbudget: f('integer', { default: 0 }),
    show_hidden: f('integer', { default: 0 }),
    show_uncategorized: f('integer', { default: 0 }),
    trim_intervals: f('integer', { default: 0 }),
    show_trend_lines: f('integer', { default: 0 }),
    include_current: f('integer', { default: 0 }),
    graph_type: f('string', { default: 'BarGraph' }),
    conditions: f('json'),
    conditions_op: f('string'),
    metadata: f('json'),
    interval: f('string', { default: 'Monthly' }),
    color_scheme: f('json'),
    tombstone: f('boolean'),
  },
  reflect_budgets: {
    id: f('id'),
    month: f('integer'),
    category: f('string'),
    amount: f('integer'),
    carryover: f('integer'),
    goal: f('integer'),
    long_goal: f('integer'),
  },
  zero_budgets: {
    id: f('id'),
    month: f('integer'),
    category: f('string', { ref: 'categories' }),
    amount: f('integer'),
    carryover: f('integer'),
    goal: f('integer'),
    long_goal: f('integer'),
  },
  dashboard_pages: {
    id: f('id'),
    name: f('string'),
    tombstone: f('boolean'),
  },
  dashboard: {
    id: f('id'),
    dashboard_page_id: f('id', { ref: 'dashboard_pages' }),
    type: f('string', { required: true }),
    width: f('integer', { required: true }),
    height: f('integer', { required: true }),
    x: f('integer', { required: true }),
    y: f('integer', { required: true }),
    meta: f('json'),
    tombstone: f('boolean'),
  },
  payee_locations: {
    id: f('id'),
    payee_id: f('id', { ref: 'payees', required: true }),
    latitude: f('float', { required: true }),
    longitude: f('float', { required: true }),
    created_at: f('integer', { required: true }),
    tombstone: f('boolean'),
  },
};

export const schemaConfig: SchemaConfig = {
  // Note: these views *must* represent the underlying table that we
  // are mapping here. The compiler makes optimizations with this
  // assumption
  tableViews(name, { isJoin, withDead, tableOptions = { splits: undefined } }) {
    switch (name) {
      case 'transactions': {
        // With `currency: 'base'`, `amount` is in the budget's base currency
        // instead of the account's, for adding up amounts across accounts
        const suffix = tableOptions.currency === 'base' ? '_base' : '';

        // If joining, we always only show alive transactions. There's
        // no way to configure join behavior yet
        if (isJoin) {
          return 'v_transactions_internal_alive' + suffix;
        }

        const splitType = tableOptions.splits || 'inline';
        // Use the view to exclude dead transactions if using `inline` or `none`
        if (!withDead && (splitType === 'inline' || splitType === 'none')) {
          return 'v_transactions_internal_alive' + suffix;
        }

        // Otherwse we disregard the `withDead` option here and handle
        // that in the executors to improve performance
        return 'v_transactions_internal' + suffix;
      }

      case 'schedules':
        return 'v_schedules';

      case 'categories':
        return 'v_categories';

      case 'payees':
        return 'v_payees';

      case 'accounts':
        return 'v_accounts';

      default:
    }
    return name;
  },

  tableDependencies(name) {
    // The accounts view looks up exchange rates and the main currency
    if (name === 'accounts') {
      return ['exchange_rates', 'preferences'];
    }
    // Whether an amount counts towards totals depends on the account's
    // currency and the main currency
    if (name === 'transactions') {
      return ['accounts', 'preferences'];
    }
    return [];
  },

  customizeQuery(queryState) {
    const { table: tableName } = queryState;

    function orderBy(orders) {
      // If order was specified, always add id as the last sort to make
      // it deterministic
      if (orders.length > 0) {
        return orders.concat(['id']);
      }

      // Otherwise, these are the default orders for each table
      switch (tableName) {
        case 'transactions':
          return [
            { date: 'desc' },
            'starting_balance_flag',
            { sort_order: 'desc' },
            'id',
          ];
        case 'category_groups':
          return ['is_income', 'sort_order', 'id'];
        case 'categories':
          return ['sort_order', 'id'];
        case 'payees':
          return [
            { $condition: { transfer_acct: null }, $dir: 'desc' },
            { $nocase: '$name' },
          ];
        case 'accounts':
          return ['sort_order', 'name'];
        case 'account_groups':
          return ['sort_order', 'id'];
        case 'exchange_rates':
          return [{ date: 'desc' }, 'id'];
        case 'schedules':
          return [{ $condition: { completed: true } }, 'next_date'];
        default:
      }

      return [];
    }

    return {
      ...queryState,
      orderExpressions: orderBy(queryState.orderExpressions),
    };
  },

  views: {
    accounts: {
      v_accounts: internalFields => {
        const mainCurrency = MAIN_CURRENCY_SQL;
        const fields = internalFields({
          // Prefer manual rates, then the direct pair, like getExchangeRate.
          // The ORDER BY must not refer to `_`: the SQLite of the browser
          // build fails on outer columns in a subquery's ORDER BY.
          latest_rate: `
            CASE
              WHEN _.currency IS NULL OR _.currency = ${mainCurrency}
                OR NULLIF(${mainCurrency}, '') IS NULL THEN 1
              ELSE IFNULL((
                SELECT CASE WHEN r.from_currency = _.currency THEN r.rate ELSE 1.0 / r.rate END
                FROM exchange_rates r
                WHERE r.tombstone = 0 AND (
                  (r.from_currency = _.currency AND r.to_currency = ${mainCurrency}) OR
                  (r.from_currency = ${mainCurrency} AND r.to_currency = _.currency)
                )
                ORDER BY r.date DESC, CASE r.source WHEN 'manual' THEN 0 ELSE 1 END,
                  r.to_currency = ${mainCurrency} DESC, r.id
                LIMIT 1
              ), 0)
            END
          `,
        });
        return `SELECT ${fields} FROM accounts _`;
      },
    },

    payees: {
      v_payees: internalFields => {
        const fields = internalFields({
          name: 'COALESCE(__accounts.name, _.name)',
        });

        return `
          SELECT ${fields} FROM payees _
          LEFT JOIN accounts __accounts ON (_.transfer_acct = __accounts.id AND __accounts.tombstone = 0)
          -- We never want to show transfer payees that are pointing to deleted accounts.
          -- Either this is not a transfer payee, if the account exists
          WHERE _.transfer_acct IS NULL OR __accounts.id IS NOT NULL
        `;
      },
    },

    categories: {
      fields: {
        group: 'cat_group',
      },

      v_categories: internalFields => {
        const fields = internalFields({ group: 'cat_group' });
        return `SELECT ${fields} FROM categories _`;
      },
    },

    schedules: {
      v_schedules: internalFields => {
        const fields = internalFields({
          next_date: `
            CASE
              WHEN _nd.local_next_date_ts = _nd.base_next_date_ts THEN _nd.local_next_date
              ELSE _nd.base_next_date
            END
          `,
          _payee: `pm.targetId`,
          _account: `json_extract(_rules.conditions, _paths.account || '.value')`,
          _amount: `json_extract(_rules.conditions, _paths.amount || '.value')`,
          _amountOp: `json_extract(_rules.conditions, _paths.amount || '.op')`,
          _date: `json_extract(_rules.conditions, _paths.date || '.value')`,
          _conditions: '_rules.conditions',
          _actions: '_rules.actions',
          _has_splits: `EXISTS (
            SELECT 1
            FROM json_each(_rules.actions) action
            WHERE json_extract(action.value, '$.options.splitIndex') > 0
          )`,
        });

        return `
        SELECT ${fields} FROM schedules _
        LEFT JOIN schedules_next_date _nd ON _nd.schedule_id = _.id
        LEFT JOIN schedules_json_paths _paths ON _paths.schedule_id = _.id
        LEFT JOIN rules _rules ON _rules.id = _.rule
        LEFT JOIN payee_mapping pm ON pm.id = json_extract(_rules.conditions, _paths.payee || '.value')
        `;
      },
    },

    transactions: {
      fields: {
        is_parent: 'isParent',
        is_child: 'isChild',
        account: 'acct',
        imported_id: 'financial_id',
        imported_payee: 'imported_description',
        transfer_id: 'transferred_id',
        payee: 'description',
      },

      v_transactions_internal: internalFields => {
        // Each part of a split is rounded on its own, so a parent adds up its
        // parts to always match them
        const convertedAmount = `
          CASE WHEN _.isParent = 1 THEN (
            SELECT SUM(c.converted_amount) FROM transactions c
            WHERE c.parent_id = _.id AND c.isChild = 1 AND c.tombstone = 0
          ) ELSE _.converted_amount END
        `;

        // Override some fields to make custom stuff
        const fields = internalFields({
          payee: 'pm.targetId',
          category: `CASE WHEN _.isParent = 1 THEN NULL ELSE cm.transferId END`,
          amount: `IFNULL(_.amount, 0)`,
          converted_amount: convertedAmount,
          // Not in the schema, so queries can't read it: the base views show
          // it as `amount`. Without an exchange rate an amount in another
          // currency can't be valued in the base one, so it counts as 0.
          base_amount: `
            COALESCE(
              ${convertedAmount},
              CASE WHEN a.currency != NULLIF(${MAIN_CURRENCY_SQL}, '') THEN 0 END,
              _.amount,
              0
            )
          `,
          parent_id: 'CASE WHEN _.isChild = 0 THEN NULL ELSE _.parent_id END',
        });

        return `
          SELECT ${fields} FROM transactions _
          LEFT JOIN category_mapping cm ON cm.id = _.category
          LEFT JOIN payee_mapping pm ON pm.id = _.description
          LEFT JOIN accounts a ON a.id = _.acct
          WHERE
           _.date IS NOT NULL AND
           _.acct IS NOT NULL AND
           (_.isChild = 0 OR _.parent_id IS NOT NULL)
        `;
      },

      // We join on t2 to only include valid child transactions. We
      // want to only include ones with valid parents, which is when
      // an alive parent transaction exists
      v_transactions_internal_alive: `
        SELECT _.* FROM v_transactions_internal _
        LEFT JOIN transactions t2 ON (_.is_child = 1 AND t2.id = _.parent_id)
        WHERE IFNULL(_.tombstone, 0) = 0 AND (_.is_child = 0 OR t2.tombstone = 0)
      `,

      // The same as the two views above, but with `amount` in the budget's
      // base currency. Use these only to add up amounts: saving a row read
      // from them would overwrite the amount with the converted one.
      v_transactions_internal_base: (_, publicFields) =>
        `SELECT ${publicFields({ amount: '_.base_amount' })} FROM v_transactions_internal _`,

      v_transactions_internal_alive_base: (_, publicFields) =>
        `SELECT ${publicFields({ amount: '_.base_amount' })} FROM v_transactions_internal_alive _`,

      v_transactions: (_, publicFields) => {
        const fields = publicFields({
          payee: 'p.id',
          category: 'c.id',
          account: 'a.id',
        });

        // This adds an order, and also validates any id references by
        // selecting the ids through a join which return null if they
        // are dead
        return `
          SELECT ${fields} FROM v_transactions_internal_alive _
          LEFT JOIN payees p ON (p.id = _.payee AND p.tombstone = 0)
          LEFT JOIN categories c ON (c.id = _.category AND c.tombstone = 0)
          LEFT JOIN accounts a ON (a.id = _.account AND a.tombstone = 0)
          ORDER BY _.date desc, _.starting_balance_flag, _.sort_order desc, _.id;
        `;
      },
    },
  },
};
