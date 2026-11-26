import { Trade } from '../models/Trade.js';
import { agedTerm } from '../lib/trades.js';

// Moves open trades up a term as they age (see agedTerm): short → mid after a month,
// → long after a year. Returns what changed; `dryRun` only reports it.
export async function ageOpenTerms(today, { dryRun = false } = {}) {
  const open = await Trade.find({ exitPrice: null, term: { $in: ['short', 'mid'] } }).lean();
  const changes = open
    .map((trade) => ({ trade, to: agedTerm(trade, today) }))
    .filter(({ trade, to }) => to !== trade.term)
    .map(({ trade, to }) => ({
      id: String(trade._id),
      symbol: trade.symbol,
      entryDate: trade.entryDate,
      from: trade.term,
      to,
    }));

  if (!dryRun && changes.length) {
    // The filter repeats the old term and open state, so a trade edited or closed
    // since it was read is left alone.
    await Trade.bulkWrite(
      changes.map(({ id, from, to }) => ({
        updateOne: { filter: { _id: id, exitPrice: null, term: from }, update: { $set: { term: to } } },
      })),
    );
  }
  return changes;
}
