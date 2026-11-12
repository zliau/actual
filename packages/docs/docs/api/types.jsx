import React from 'react';

export const types = {
  id: {
    name: 'id',
    type: 'string',
    description: (
      <span>
        <a href="https://en.wikipedia.org/wiki/Universally_unique_identifier">
          UUID
        </a>
      </span>
    ),
  },
  month: {
    name: 'month',
    type: 'string',
    description: <code>YYYY-MM</code>,
  },
  date: {
    name: 'date',
    type: 'string',
    description: <code>YYYY-MM-DD</code>,
  },
  amount: {
    name: 'amount',
    type: 'integer',
    description: (
      <span>
        A currency amount is an integer: the value multiplied by 100, whatever
        the currency. For example, <code>$120.30</code> is <code>12030</code>{' '}
        and <code>¥1,500</code> is <code>150000</code>.
      </span>
    ),
  },
};

export const objects = {
  initConfig: [
    {
      name: 'serverURL',
      type: 'string',
      description: <span>The URL of your Actual Budget server.</span>,
    },
    {
      name: 'password',
      type: 'string',
      description: <span>The password of your Actual Budget server.</span>,
    },
    {
      name: 'dataDir',
      type: 'string',
      description: (
        <span>The directory to store locally cached budget files.</span>
      ),
    },
    {
      name: 'verbose',
      type: 'boolean',
      description: <span>Enable/disable logging from actual internals</span>,
    },
  ],

  transaction: [
    {
      name: 'id',
      type: types.id,
    },
    { name: 'account', type: types.id, required: true },
    { name: 'date', type: 'date', required: true },
    { name: 'amount', type: types.amount },
    {
      name: 'payee',
      type: types.id,
      description: (
        <span>
          In a <a href="#types-of-methods">create</a> request, this overrides{' '}
          <code>payee_name</code>.
        </span>
      ),
    },
    {
      name: 'payee_name',
      type: 'string',
      description: (
        <div>
          <div className="mb-6">
            If given, a payee will be created with this name. If this matches an
            already existing payee, that payee will be used.
          </div>
          * Only available in a <a href="#types-of-methods">create</a> request
        </div>
      ),
    },
    {
      name: 'imported_payee',
      type: 'string',
      description:
        'This can be anything. Meant to represent the raw description when importing, allowing the user to see the original value.',
    },
    { name: 'category', type: types.id },
    { name: 'notes', type: 'string' },
    {
      name: 'imported_id',
      type: 'string',
      description:
        'A unique id usually given by the bank, if importing. Use this to avoid duplicate transactions.',
    },
    {
      name: 'transfer_id',
      type: 'string',
      description: (
        <span>
          If a transfer, the <code>id</code> of the corresponding transaction in
          the other account. See <a href="#transfers">transfers</a>.
        </span>
      ),
    },
    {
      name: 'cleared',
      type: 'boolean',
      description: (
        <span>A flag indicating if the transaction has cleared or not.</span>
      ),
    },
    {
      name: 'subtransactions',
      type: 'Transaction[]',
      description: (
        <div>
          <div className="mb-6">
            An array of subtransactions for a split transaction. See{' '}
            <a href="#split-transactions">split transactions</a>.
          </div>
          * Only available in a <a href="#types-of-methods">get</a> or{' '}
          <a href="#types-of-methods">create</a> request
        </div>
      ),
    },
  ],

  account: [
    { name: 'id', type: types.id },
    { name: 'name', type: 'string', required: true },
    {
      name: 'offbudget',
      type: 'bool',
      description: (
        <span>
          Defaults to <code>false</code>
        </span>
      ),
    },
    {
      name: 'closed',
      type: 'bool',
      description: (
        <span>
          Defaults to <code>false</code>
        </span>
      ),
    },
    {
      name: 'balance_current',
      type: 'number | null',
      description: (
        <span>
          The current balance of the account as reported by bank sync. Can also
          be set manually. Defaults to <code>null</code>
        </span>
      ),
    },
    {
      name: 'account_group_id',
      type: 'id | null',
      description: (
        <span>
          The <a href="#account-group">account group</a> this account belongs
          to. Defaults to <code>null</code>
        </span>
      ),
    },
    {
      name: 'currency',
      type: 'string | null',
      description: (
        <span>
          The currency code of the account, or <code>null</code> for the main
          currency of the budget. Can only be set when creating the account.
        </span>
      ),
    },
    {
      name: 'investment',
      type: 'boolean',
      description: (
        <span>
          Whether this is an <a href="#investments">investment account</a>. Can
          only be set when creating the account, which then needs a{' '}
          <code>currency</code> of <code>USD</code> or <code>CAD</code>, and is
          always off budget.
        </span>
      ),
    },
  ],

  security: [
    { name: 'id', type: types.id, description: 'The exchange and symbol.' },
    { name: 'symbol', type: 'string', required: true },
    {
      name: 'exchange',
      type: 'string',
      required: true,
      description: (
        <span>
          <code>US</code> or <code>TSX</code>.
        </span>
      ),
    },
    { name: 'name', type: 'string | null' },
    {
      name: 'currency',
      type: 'string',
      description: 'Set by the exchange.',
    },
  ],

  trade: [
    { name: 'id', type: types.id },
    { name: 'account', type: types.id, required: true },
    { name: 'security', type: types.id, required: true },
    { name: 'date', type: types.date, required: true },
    {
      name: 'type',
      type: 'string',
      required: true,
      description: (
        <span>
          <code>buy</code>, <code>sell</code>, <code>vest</code>,{' '}
          <code>dividend</code>, <code>reinvested-dividend</code>,{' '}
          <code>return-of-capital</code>, <code>move-out</code> or{' '}
          <code>move-in</code>. A reinvested dividend is shares a dividend
          bought, and moves no cash. A return of capital lowers what the shares
          cost, and anything past zero is a realized gain. A vest is shares
          received as pay, such as RSUs, and moves no cash. A move is shares
          going to another of the user's accounts: they keep their cost and no
          cash moves. It is added as a <code>move-out</code> with{' '}
          <code>transfer_account</code>, and the <code>move-in</code> is written
          in that account.
        </span>
      ),
    },
    {
      name: 'quantity',
      type: 'number',
      description:
        'The number of shares, which can be fractional. For a vest, the shares that arrived. Required except for a dividend or return of capital, which have none.',
    },
    {
      name: 'price',
      type: 'number',
      description: (
        <span>
          The price per share as a decimal, so $12.50 is <code>12.5</code>. For
          a move, the market price that day, which values the shares but doesn't
          change their cost. Required except for a dividend or return of
          capital, which have none.
        </span>
      ),
    },
    {
      name: 'fee',
      type: types.amount,
      description:
        'Optional; will default to 0. Only a buy or sell can have a fee.',
    },
    {
      name: 'withheld',
      type: 'number',
      description:
        'The shares a vest held back for tax, which never arrived. Optional; will default to 0, and must be 0 for anything but a vest.',
    },
    {
      name: 'amount',
      type: types.amount,
      description:
        'What a dividend or return of capital paid. Required for those, and must be 0 for anything else.',
    },
    {
      name: 'transfer_id',
      type: 'id | null',
      description: 'For a move, the trade of the other half of it.',
    },
    {
      name: 'transfer_account',
      type: 'id | null',
      description: (
        <span>
          For a move, the account the shares went to or came from. Set it when
          adding a <code>move-out</code>.
        </span>
      ),
    },
    {
      name: 'transaction_id',
      type: 'id | null',
      description: "The transaction that moves the trade's cash.",
    },
  ],

  securityPrice: [
    { name: 'id', type: types.id },
    { name: 'security', type: types.id, required: true },
    { name: 'date', type: types.date, required: true },
    {
      name: 'close',
      type: 'number',
      required: true,
      description: 'The closing price per share as a decimal, as traded.',
    },
    {
      name: 'source',
      type: 'string',
      description: (
        <span>
          <code>manual</code> or <code>api</code>.
        </span>
      ),
    },
  ],

  securitySplit: [
    { name: 'id', type: types.id },
    { name: 'security', type: types.id, required: true },
    { name: 'date', type: types.date, required: true },
    {
      name: 'ratio',
      type: 'number',
      required: true,
      description: (
        <span>
          New shares for each old one: a 4-for-1 split is <code>4</code>, and a
          1-for-10 split is <code>0.1</code>.
        </span>
      ),
    },
    {
      name: 'status',
      type: 'string',
      description: (
        <span>
          <code>confirmed</code> or <code>suggested</code>. Only confirmed
          splits change holdings.
        </span>
      ),
    },
  ],

  holding: [
    { name: 'security', type: types.id },
    { name: 'symbol', type: 'string' },
    { name: 'name', type: 'string | null' },
    { name: 'currency', type: 'string' },
    {
      name: 'quantity',
      type: 'number',
      description: 'The shares held, which is 0 once everything is sold.',
    },
    {
      name: 'averageCost',
      type: 'number',
      description: 'The cost per share as a decimal, including fees.',
    },
    { name: 'costBasis', type: types.amount },
    {
      name: 'price',
      type: 'number',
      description: 'The price per share used to value the holding.',
    },
    { name: 'priceDate', type: types.date },
    { name: 'marketValue', type: types.amount },
    { name: 'unrealizedGain', type: types.amount },
    {
      name: 'unrealizedGainRatio',
      type: 'number',
      description: (
        <span>
          The gain as a share of the cost, so a 10% gain is <code>0.1</code>.
        </span>
      ),
    },
    { name: 'realizedGain', type: types.amount },
    {
      name: 'dividends',
      type: types.amount,
      description:
        'What the security has paid out in dividends in this account so far, reinvested ones included.',
    },
  ],

  accountGroup: [
    { name: 'id', type: types.id },
    { name: 'name', type: 'string', required: true },
  ],

  category: [
    { name: 'id', type: types.id },
    { name: 'name', type: 'string', required: true },
    { name: 'group_id', type: types.id, required: true },
    {
      name: 'is_income',
      type: 'bool',
      description: (
        <span>
          Defaults to <code>false</code>
        </span>
      ),
    },
  ],

  categoryGroup: [
    { name: 'id', type: types.id },
    { name: 'name', type: 'string', required: true },
    {
      name: 'is_income',
      type: 'bool',
      description: (
        <span>
          Defaults to <code>false</code>
        </span>
      ),
    },
    {
      name: 'categories',
      type: 'Category[]',
      description: (
        <div>
          <div className="mb-6">
            An array of categories in this group. Not valid when creating or
            updating a category group
          </div>
          Only available in a <code>get</code>.
        </div>
      ),
    },
  ],

  schedule: [
    {
      name: 'id',
      type: types.id,
    },
    {
      name: 'name',
      type: 'string',
      description: (
        <span>Not mandatory but schedule names must be unique.</span>
      ),
    },
    {
      name: 'rule',
      type: 'string',
      description: (
        <span>
          All schedules have an associated underlying rule. Not to be supplied
          with a new schedule. It will be auto created. Rules can not updated to
          another rule. You can however edit the rule with the API above for
          Rule.
        </span>
      ),
    },
    {
      name: 'next_date',
      type: 'string',
      description: (
        <span>
          Next occurrence of a schedule. Not to be supplied with a new schedule.
        </span>
      ),
    },
    {
      name: 'completed',
      type: 'boolean',
      description: <span>Not to be supplied with a new schedule.</span>,
    },
    {
      name: 'posts_transaction',
      type: 'boolean',
      description: (
        <span>
          Whether the schedule should auto-post transactions on your behalf.
          Defaults to <code>false</code>.
        </span>
      ),
    },
    {
      name: 'payee',
      type: 'id | null',
      description: (
        <span>
          Optional; will default to <code>null</code>.
        </span>
      ),
    },
    {
      name: 'account',
      type: 'id | null',
      description: (
        <span>
          Optional; will default to <code>null</code>.
        </span>
      ),
    },
    {
      name: 'amount',
      type: 'number | { num1: number; num2: number }',
      description: (
        <span>
          Provide only one number, except if the amount uses a isbetween in
          amountOp, in this case num1 and 2 should be provided.
        </span>
      ),
    },
    {
      name: 'amountOp',
      type: "'is' | 'isapprox' | 'isbetween'",
      description: (
        <span>
          Controls how <code>amount</code> is interpreted.
        </span>
      ),
    },
    {
      name: 'date',
      type: 'date | RecurConfig',
      required: true,
      description: (
        <span>
          Mandatory field when creating a schedule. If the schedule is a single
          occurrence just supply the date. otherwise refer to RecurConfig
          details below.
        </span>
      ),
    },
  ],

  recurConfig: [
    {
      name: 'frequency',
      type: `'daily' | 'weekly' | 'monthly' | 'yearly'`,
      required: true,
      description: <span>How often the schedule repeats.</span>,
    },
    {
      name: 'interval',
      type: 'number',
      description: (
        <span>
          The interval at which the recurrence happens. Defaults to{' '}
          <code>1</code> if omitted.
        </span>
      ),
    },
    {
      name: 'patterns',
      type: 'RecurPattern[]',
      description: (
        <span>
          Optional patterns to control specific dates for recurrence (e.g.
          certain weekdays or month days).
        </span>
      ),
    },
    {
      name: 'skipWeekend',
      type: 'boolean',
      description: (
        <span>If true, skips weekends when calculating recurrence dates.</span>
      ),
    },
    {
      name: 'start',
      type: 'string',
      required: true,
      description: (
        <span>
          The ISO date string indicating the start date of the recurrence.
        </span>
      ),
    },
    {
      name: 'endMode',
      type: `'never' | 'after_n_occurrences' | 'on_date'`,
      required: true,
      description: (
        <span>
          Specifies how the recurrence ends: never ends, after a number of
          occurrences, or on a specific date.
        </span>
      ),
    },
    {
      name: 'endOccurrences',
      type: 'number',
      description: (
        <span>
          Used when <code>endMode</code> is <code>'after_n_occurrences'</code>.
          Indicates how many times it should repeat.
        </span>
      ),
    },
    {
      name: 'endDate',
      type: 'string',
      description: (
        <span>
          Used when <code>endMode</code> is <code>'on_date'</code>. The ISO date
          string indicating when the recurrence should end.
        </span>
      ),
    },
    {
      name: 'weekendSolveMode',
      type: `'before' | 'after'`,
      description: (
        <span>
          If a calculated date falls on a weekend and <code>skipWeekend</code>{' '}
          is true, this controls whether the date moves to the{' '}
          <code>before</code> or <code>after</code> weekday.
        </span>
      ),
    },
  ],

  payee: [
    { name: 'id', type: types.id },
    { name: 'name', type: 'string', required: true },
    { name: 'category', type: types.id },
    {
      name: 'transfer_acct',
      type: types.id,
      description: (
        <span>
          The <code>id</code> of the account this payee transfers to/from, if
          this is a transfer payee.
        </span>
      ),
    },
  ],

  tag: [
    { name: 'id', type: types.id },
    { name: 'tag', type: 'string', required: true },
    { name: 'color', type: 'string' },
    { name: 'description', type: 'string' },
    { name: 'hidden', type: 'boolean' },
  ],

  condition: [
    { name: 'field', type: 'string', required: true },
    { name: 'op', type: 'string', required: true },
    { name: 'value', type: 'string', required: true },
  ],

  rule: [
    { name: 'id', type: types.id },
    {
      name: 'stage',
      type: 'string',
      required: true,
      description: (
        <span>
          Must be one of <code>pre</code>, <code>default</code>, or{' '}
          <code>post</code>.
        </span>
      ),
    },
    {
      name: 'conditionsOp',
      type: 'string',
      description: (
        <span>
          Must be one of <code>and</code> or <code>or</code>.
        </span>
      ),
    },
    { name: 'conditions', type: 'ConditionOrAction[]' },
    { name: 'actions', type: 'ConditionOrAction[]' },
  ],

  budgetFile: [
    {
      name: 'name',
      type: 'string',
      required: true,
      description: <span>The budget's name.</span>,
    },
    {
      name: 'cloudFileId',
      type: 'string',
      required: true,
      description: (
        <span>
          The id for the budget on the server. This is usually a UUID.
        </span>
      ),
    },
    {
      name: 'groupId',
      type: 'string',
      required: true,
      description: <span>The group id for the budget.</span>,
    },
    {
      name: 'hasKey',
      type: 'boolean',
      required: true,
      description: <span>If the file has an encryption key.</span>,
    },
    {
      name: 'encryptKeyId',
      type: 'string',
      description: (
        <span>The encryption key ID for the file, if it is encrypted.</span>
      ),
    },
    {
      name: 'state',
      type: 'string',
      description: <span>Remote files have this set to "remote".</span>,
    },
    {
      name: 'id',
      type: 'string',
      description: <span>The local budget file's local ID.</span>,
    },
  ],
};

function Table({ style, headers, className, children }) {
  return (
    <table className={`text-sm ${className}`} style={style}>
      <thead>
        <tr>
          {headers.map(header => (
            <th key={header} className="text-gray-900 font-thin">
              {header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="border">{children}</tbody>
    </table>
  );
}

export function PrimitiveTypeList() {
  return (
    <Table headers={['Name', 'Type', 'Notes']} style={{ maxWidth: 700 }}>
      {Object.keys(types).map(name => {
        return (
          <PrimitiveType
            key={name}
            name={types[name].name}
            type={types[name].type}
            description={types[name].description}
          />
        );
      })}
    </Table>
  );
}

export function PrimitiveType({ name, type, description }) {
  return (
    <tr>
      <td valign="top">
        <code>{name}</code>
      </td>
      <td valign="top">
        <code className="text-gray-600">{type}</code>
      </td>
      <td>{description}</td>
    </tr>
  );
}

export function StructType({ fields }) {
  return (
    <div className="struct mt-4 mb-10">
      <Table
        className="mb-0"
        showBorder={true}
        headers={['Field', 'Type', 'Required?', 'Notes']}
      >
        {fields.map(field => {
          return (
            <tr key={field.name}>
              <td valign="top">
                <code>{field.name}</code>
              </td>
              <td valign="top">
                <code className="text-gray-600">
                  {typeof field.type === 'string'
                    ? field.type
                    : field.type.name}
                </code>
              </td>
              <td valign="top">{field.required ? 'yes' : 'no'}</td>
              <td>{field.description}</td>
            </tr>
          );
        })}
      </Table>
    </div>
  );
}

function Argument({ arg }) {
  if (arg.properties) {
    return (
      <span>
        {arg.name ? arg.name + ': ' : ''}
        {'{ '}
        {arg.properties
          .map(prop => <Argument key={prop.name} arg={prop} />)
          .map(insertCommas)}
        {' }'}
      </span>
    );
  }
  return (
    <span style={{ position: 'relative' }}>
      <span
        className="text-gray-500"
        style={{ position: 'absolute', bottom: -20, fontSize: 12 }}
      >
        {arg.type}
      </span>
      {arg.name}
    </span>
  );
}

function insertCommas(element, i, arr) {
  if (i === arr.length - 1) {
    return element;
  }
  return [element, ', '];
}

export function Method({ name, args, returns = 'Promise<null>', children }) {
  return (
    <p className="method">
      <div className="p-4 pb-6 rounded border-b bg-gray-100 overflow-auto">
        <code className="text-blue-800">
          {name}(
          {args
            .map(arg => <Argument key={arg.name} arg={arg} />)
            .map(insertCommas)}
          ) <span className="text-gray-500">&rarr; {returns}</span>
        </code>
      </div>
      {children && React.cloneElement(children, {})}
    </p>
  );
}

export function MethodBox({ children }) {
  return <div style={{ border: '1px solid red' }}>{children}</div>;
}
