import * as db from '#server/db';
import { ValidationError } from '#server/errors';
import { getSharesBeforeExDate, SHARE_EPSILON } from '#shared/investments';
import type { HoldingTrade } from '#shared/investments';
import { amountToInteger } from '#shared/util';
import type {
  DividendSuggestion,
  DividendSuggestionStatus,
  SecurityEntity,
  SecuritySplitEntity,
  TradeEntity,
} from '#types/models';

// Records a dividend a provider reported, for each open account that traded the
// security before its ex-date. Whether one held shares then is worked out when
// the suggestion is shown, so later changes to its trades count. One already
// stored is left alone, so an answered dividend doesn't come back.
export async function suggestDividend({
  security,
  date,
  perShare,
}: {
  security: SecurityEntity['id'];
  date: string;
  perShare: number;
}) {
  if (!Number.isFinite(perShare) || perShare <= 0) {
    return;
  }
  const accounts = await db.all<Pick<db.DbAccount, 'id'>>(
    `SELECT DISTINCT a.id FROM accounts a
     JOIN trades t ON t.account = a.id AND t.tombstone = 0
     WHERE a.investment = 1 AND a.tombstone = 0 AND a.closed = 0
       AND t.security = ? AND t.date < ?`,
    [security, db.toDateRepr(date)],
  );
  for (const { id: account } of accounts) {
    const id = `${account}-${security}-${date}`;
    const existing = await db.first<Pick<db.DbDividendSuggestion, 'id'>>(
      'SELECT id FROM dividend_suggestions WHERE id = ?',
      [id],
    );
    if (!existing) {
      await db.insert('dividend_suggestions', {
        id,
        account,
        security,
        date: db.toDateRepr(date),
        per_share: perShare,
        status: 'suggested',
        tombstone: 0,
      });
    }
  }
}

// The account's dividends waiting for an answer, for what it held on each
// ex-date. Ones it held no shares for are left out.
export async function getSuggestedDividends({
  account,
  trades,
  splits,
  securities,
}: {
  account: TradeEntity['account'];
  trades: Array<HoldingTrade & Pick<TradeEntity, 'security'>>;
  splits: SecuritySplitEntity[];
  securities: Array<Pick<SecurityEntity, 'id' | 'symbol'>>;
}): Promise<DividendSuggestion[]> {
  const rows = await db.all<db.DbDividendSuggestion>(
    `SELECT * FROM dividend_suggestions
     WHERE account = ? AND status = 'suggested' AND tombstone = 0
     ORDER BY date`,
    [account],
  );
  return rows.flatMap(row => {
    const security = securities.find(({ id }) => id === row.security);
    if (!security) {
      return [];
    }
    const date = db.fromDateRepr(row.date);
    const securityTrades = trades.filter(
      trade => trade.security === row.security,
    );
    const shares = getSharesBeforeExDate(
      securityTrades,
      splits.filter(
        split =>
          split.security === row.security && split.status === 'confirmed',
      ),
      date,
    );
    if (shares < SHARE_EPSILON) {
      return [];
    }
    const lastDividend = securityTrades
      .filter(
        trade =>
          trade.type === 'dividend' || trade.type === 'reinvested-dividend',
      )
      .sort((a, b) => a.date.localeCompare(b.date))
      .at(-1);
    return [
      {
        id: row.id,
        account,
        security: row.security,
        symbol: security.symbol,
        date,
        perShare: row.per_share,
        shares,
        amount: amountToInteger(shares * row.per_share),
        wasLastReinvested: lastDividend?.type === 'reinvested-dividend',
      },
    ];
  });
}

// Marks a suggested dividend as recorded as a trade, or as ignored
export async function answerDividendSuggestion({
  id,
  status,
}: {
  id: DividendSuggestion['id'];
  status: Exclude<DividendSuggestionStatus, 'suggested'>;
}): Promise<void> {
  if (status !== 'dismissed' && status !== 'recorded') {
    throw new ValidationError(`invalid dividend answer '${String(status)}'`);
  }
  const existing = await db.first<Pick<db.DbDividendSuggestion, 'id'>>(
    'SELECT id FROM dividend_suggestions WHERE id = ? AND tombstone = 0',
    [id],
  );
  if (!existing) {
    throw new ValidationError(`dividend suggestion '${id}' does not exist`);
  }
  await db.update('dividend_suggestions', { id, status });
}
