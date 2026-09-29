// Trade math shared by the React app, the Express API and the tests.
// Everything here is pure: no I/O, no clocks except localISODate().

export const SIDES = ['buy', 'short'];
export const TERMS = ['short', 'mid', 'long'];
export const TERM_LABELS = { short: 'Short term', mid: 'Mid term', long: 'Long term' };

export const isOpen = (trade) => trade.exitPrice == null;

// Quantities may be fractional; trim float noise left over from subtraction.
export const roundQty = (n) => Math.round(n * 1e6) / 1e6;

const toCents = (dollars) => Math.round(dollars * 100);

// Profit from the price move alone, in whole cents. A buy earns when it exits
// higher, a short earns when it exits lower.
export function grossCents(trade, exitPrice = trade.exitPrice, quantity = trade.quantity) {
  if (exitPrice == null) return 0;
  const perShare =
    trade.side === 'short' ? trade.entryPrice - exitPrice : exitPrice - trade.entryPrice;
  return toCents(perShare * quantity);
}

export const marginCents = (trade) => toCents(trade.margin ?? 0);

// Realized profit in cents: the price move minus margin, so margin deepens a
// loss and shrinks a profit. Open trades have realized nothing.
export function pnlCents(trade) {
  return isOpen(trade) ? 0 : grossCents(trade) - marginCents(trade);
}

export const realizedPnl = (trade) => pnlCents(trade) / 100;

// True when exiting this many shares leaves nothing open.
export const closesPosition = (trade, quantity) => roundQty(trade.quantity - quantity) <= 0;

// What an exit would realize. Margin stays with the position and is charged
// only on the exit that closes its last shares.
export function exitPnlCents(trade, { exitPrice, quantity, margin = trade.margin ?? 0 }) {
  const charged = closesPosition(trade, quantity) ? toCents(margin) : 0;
  return grossCents(trade, exitPrice, quantity) - charged;
}

// Net return on the money put in (entry price × shares).
export function returnPct(trade) {
  const cost = toCents(trade.entryPrice * trade.quantity);
  return cost ? (pnlCents(trade) / cost) * 100 : 0;
}

// Calendar dates travel as YYYY-MM-DD strings, so a trade's day never
// shifts with time zones. Arithmetic runs in UTC on those strings.
const DAY_MS = 86_400_000;
const FRIDAY = 5;
const toUTC = (iso) => Date.parse(`${iso}T00:00:00Z`);
const fromUTC = (ms) => new Date(ms).toISOString().slice(0, 10);

export function isISODate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = toUTC(value);
  return !Number.isNaN(ms) && fromUTC(ms) === value; // rejects 2026-02-30
}

export function localISODate(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export const addDays = (iso, days) => fromUTC(toUTC(iso) + days * DAY_MS);
export const daysBetween = (from, to) => Math.round((toUTC(to) - toUTC(from)) / DAY_MS);

// Weeks run Friday through Thursday: a new week starts every Friday.
export function weekStart(today) {
  const weekday = new Date(toUTC(today)).getUTCDay();
  return addDays(today, -((weekday - FRIDAY + 7) % 7));
}
export const weekEnd = (today) => addDays(weekStart(today), 6);
export const monthStart = (today) => `${today.slice(0, 7)}-01`;
export const yearStart = (today) => `${today.slice(0, 4)}-01-01`;

export const filterByTerm = (trades, term) =>
  term === 'all' ? trades : trades.filter((trade) => trade.term === term);

// Realized profit for this week, month, year and overall. A trade counts in
// a period when its exit date falls in it; open trades never count.
export function summarize(trades, today) {
  const periods = {
    week: { from: weekStart(today), to: weekEnd(today) },
    month: { from: monthStart(today) },
    year: { from: yearStart(today) },
    overall: { from: null },
  };
  const cents = { week: 0, month: 0, year: 0, overall: 0 };
  const margins = { week: 0, month: 0, year: 0, overall: 0 };
  const counts = { week: 0, month: 0, year: 0, overall: 0 };
  let openCount = 0;
  let firstDate = null;

  for (const trade of trades) {
    if (!firstDate || trade.entryDate < firstDate) firstDate = trade.entryDate;
    if (isOpen(trade)) {
      openCount += 1;
      continue;
    }
    const tradeCents = pnlCents(trade);
    const tradeMargin = marginCents(trade);
    for (const [key, period] of Object.entries(periods)) {
      if (period.from && trade.exitDate < period.from) continue;
      cents[key] += tradeCents;
      margins[key] += tradeMargin;
      counts[key] += 1;
    }
  }

  const result = { openCount, firstDate };
  for (const [key, period] of Object.entries(periods)) {
    result[key] = {
      ...period,
      pnl: cents[key] / 100,
      margin: margins[key] / 100,
      count: counts[key],
    };
  }
  return result;
}

const createdMs = (trade) => (trade.createdAt ? new Date(trade.createdAt).getTime() : 0);
const newestFirst = (a, b) => (a < b ? 1 : a > b ? -1 : 0);

// Open positions first, newest entry on top; then closed trades by exit date, newest first.
export function sortTrades(trades) {
  return [...trades].sort((a, b) => {
    const aOpen = isOpen(a);
    if (aOpen !== isOpen(b)) return aOpen ? -1 : 1;
    return (
      (aOpen ? 0 : newestFirst(a.exitDate, b.exitDate)) ||
      newestFirst(a.entryDate, b.entryDate) ||
      createdMs(b) - createdMs(a)
    );
  });
}

// Checks a sell (for a buy) or a buy-back (for a short) before it is saved.
// Returns a message for the person entering it, or null when it is fine.
export function exitProblem(trade, { quantity, exitPrice, exitDate, margin = trade.margin ?? 0 }) {
  if (!isOpen(trade)) return 'This position is already closed.';
  if (!(Number.isFinite(exitPrice) && exitPrice > 0)) {
    return trade.side === 'short' ? 'Enter the buy price.' : 'Enter the sell price.';
  }
  if (!(Number.isFinite(quantity) && quantity > 0)) return 'Enter how many shares to exit.';
  if (quantity > trade.quantity + 1e-9) {
    return `This position only has ${trade.quantity} shares.`;
  }
  if (!isISODate(exitDate)) return 'Enter the exit date.';
  if (exitDate < trade.entryDate) return 'The exit date can’t be before the entry date.';
  if (!(Number.isFinite(margin) && margin >= 0)) return 'Margin must be $0 or more.';
  return null;
}
