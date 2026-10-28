import type { IntegerAmount } from '#shared/util';

import type { AccountEntity } from './account';
import type { CategoryEntity } from './category';
import type { PayeeEntity } from './payee';
import type { ScheduleEntity } from './schedule';

export type TransactionEntity = {
  id: string;
  is_parent?: boolean;
  is_child?: boolean;
  parent_id?: TransactionEntity['id'];
  account: AccountEntity['id'];
  category?: CategoryEntity['id'];
  amount: IntegerAmount;
  // The amount in the budget's main currency, or null when the account
  // already uses it or no exchange rate is known
  converted_amount?: IntegerAmount | null;
  // The converted amount, or the amount when there is none. Read only.
  main_amount?: IntegerAmount;
  payee?: PayeeEntity['id'] | null;
  notes?: string;
  date: string;
  imported_id?: string;
  imported_payee?: string;
  starting_balance_flag?: boolean;
  transfer_id?: TransactionEntity['id'];
  sort_order?: number;
  cleared?: boolean;
  reconciled?: boolean;
  tombstone?: boolean;
  forceUpcoming?: boolean;
  schedule?: ScheduleEntity['id'];
  subtransactions?: TransactionEntity[];
  _unmatched?: boolean;
  _deleted?: boolean;
  error?: {
    type: 'SplitTransactionError';
    version: 1;
    difference: number;
  } | null;
  raw_synced_data?: string | undefined;
  _ruleErrors?: string[];
};
