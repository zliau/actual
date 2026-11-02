import * as db from '#server/db';
import type { SecurityPriceEntity, SecurityPriceSource } from '#types/models';

// Stores a security's close for a day, replacing the one already stored. A
// fetched price never replaces one the user entered, so manual corrections
// survive the next fetch.
export async function storeSecurityPrice({
  security,
  date,
  close,
  source,
}: Pick<SecurityPriceEntity, 'security' | 'date' | 'close'> & {
  source: SecurityPriceSource;
}): Promise<SecurityPriceEntity['id']> {
  // The id comes from the security and day so devices storing the same price
  // while they can't sync end up with one row. Clearing the tombstone brings
  // back a price that was deleted.
  const id = `${security}-${date}`;
  const existing = await db.first<
    Pick<db.DbSecurityPrice, 'source' | 'tombstone'>
  >('SELECT source, tombstone FROM security_prices WHERE id = ?', [id]);

  if (existing) {
    if (
      source === 'api' &&
      existing.source === 'manual' &&
      !existing.tombstone
    ) {
      return id;
    }
    await db.update('security_prices', { id, close, source, tombstone: 0 });
    return id;
  }

  await db.insert('security_prices', {
    id,
    security,
    date: db.toDateRepr(date),
    close,
    source,
    tombstone: 0,
  });
  return id;
}
