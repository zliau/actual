import * as db from '#server/db';
import { ValidationError } from '#server/errors';
import { sellsMoreThanHeld } from '#shared/investments';
import { isValidYearMonthDay } from '#shared/months';
import type { SecuritySplitEntity, TradeEntity } from '#types/models';

import { updateMarketValueOfHolders } from './market-value';

type SplitResult = { error: 'sells-more-than-held' } | { id: string };

export function fromDbSecuritySplit(
  row: db.DbSecuritySplit,
): SecuritySplitEntity {
  return {
    id: row.id,
    security: row.security,
    date: db.fromDateRepr(row.date),
    ratio: row.ratio,
    status: row.status,
  };
}

// Splits that were applied or entered, which are the only ones that count
export async function getConfirmedSplits(
  security: SecuritySplitEntity['security'],
) {
  const rows = await db.all<db.DbSecuritySplit>(
    `SELECT * FROM security_splits
     WHERE security = ? AND status = 'confirmed' AND tombstone = 0`,
    [security],
  );
  return rows.map(fromDbSecuritySplit);
}

// Splits to show for a security: dismissed ones stay stored, so they aren't
// suggested again, but are otherwise as good as gone
export async function getSecuritySplits({
  security,
}: Pick<SecuritySplitEntity, 'security'>): Promise<SecuritySplitEntity[]> {
  const rows = await db.all<db.DbSecuritySplit>(
    `SELECT * FROM security_splits
     WHERE security = ? AND status != 'dismissed' AND tombstone = 0
     ORDER BY date DESC`,
    [security],
  );
  return rows.map(fromDbSecuritySplit);
}

// A split changes how many shares every account holds from that day, so a sell
// entered later might no longer be covered in any of them
async function wouldSellMoreThanHeld(
  security: SecuritySplitEntity['security'],
  splits: Array<Pick<SecuritySplitEntity, 'date' | 'ratio'>>,
) {
  const trades = await db.all<db.DbTrade>(
    'SELECT * FROM trades WHERE security = ? AND tombstone = 0',
    [security],
  );
  const byAccount = new Map<
    string,
    Array<Pick<TradeEntity, 'date' | 'type' | 'quantity'>>
  >();
  for (const trade of trades) {
    byAccount.set(trade.account, [
      ...(byAccount.get(trade.account) ?? []),
      { ...trade, date: db.fromDateRepr(trade.date) },
    ]);
  }
  return [...byAccount.values()].some(accountTrades =>
    sellsMoreThanHeld(accountTrades, splits),
  );
}

// Enters a split, or applies a suggested one. The ratio is the new shares for
// each old one, so a 4-for-1 split is 4 and a 1-for-10 one is 0.1.
export async function setSecuritySplit({
  security,
  date,
  ratio,
}: Pick<
  SecuritySplitEntity,
  'security' | 'date' | 'ratio'
>): Promise<SplitResult> {
  if (!isValidYearMonthDay(date)) {
    throw new ValidationError(`security split has invalid date '${date}'`);
  }
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio === 1) {
    throw new ValidationError(
      'security split must have a positive ratio other than 1',
    );
  }

  const id = `${security}-${date}`;
  const others = (await getConfirmedSplits(security)).filter(
    split => split.id !== id,
  );
  if (await wouldSellMoreThanHeld(security, [...others, { date, ratio }])) {
    return { error: 'sells-more-than-held' };
  }

  const existing = await db.first<Pick<db.DbSecuritySplit, 'id'>>(
    'SELECT id FROM security_splits WHERE id = ?',
    [id],
  );
  if (existing) {
    await db.update('security_splits', {
      id,
      ratio,
      status: 'confirmed',
      tombstone: 0,
    });
  } else {
    await db.insert('security_splits', {
      id,
      security,
      date: db.toDateRepr(date),
      ratio,
      status: 'confirmed',
      tombstone: 0,
    });
  }
  await updateMarketValueOfHolders(security);
  return { id };
}

// Leaves a suggested split unapplied, and stops it from being suggested again
export async function dismissSecuritySplit({
  id,
}: Pick<SecuritySplitEntity, 'id'>): Promise<void> {
  await db.update('security_splits', { id, status: 'dismissed' });
}

export async function deleteSecuritySplit({
  id,
}: Pick<SecuritySplitEntity, 'id'>): Promise<SplitResult> {
  const row = await db.first<db.DbSecuritySplit>(
    'SELECT * FROM security_splits WHERE id = ?',
    [id],
  );
  if (!row) {
    throw new ValidationError(`security split '${id}' does not exist`);
  }

  const others = (await getConfirmedSplits(row.security)).filter(
    split => split.id !== id,
  );
  if (await wouldSellMoreThanHeld(row.security, others)) {
    return { error: 'sells-more-than-held' };
  }

  await db.delete_('security_splits', id);
  await updateMarketValueOfHolders(row.security);
  return { id };
}

// Records a split a provider reported, for the user to confirm: providers can
// report other distributions the same way. One already stored is left alone,
// so a dismissed or deleted split doesn't come back.
export async function suggestSecuritySplit({
  security,
  date,
  ratio,
}: Pick<SecuritySplitEntity, 'security' | 'date' | 'ratio'>) {
  const id = `${security}-${date}`;
  const existing = await db.first<Pick<db.DbSecuritySplit, 'id'>>(
    'SELECT id FROM security_splits WHERE id = ?',
    [id],
  );
  if (!existing) {
    await db.insert('security_splits', {
      id,
      security,
      date: db.toDateRepr(date),
      ratio,
      status: 'suggested',
      tombstone: 0,
    });
  }
}
