import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculatedPnlCents,
  exitPnlCents,
  exitProblem,
  filterByTerm,
  isISODate,
  pnlCents,
  realizedPnl,
  returnPct,
  sortTrades,
  summarize,
  weekEnd,
  weekStart,
} from '../server/lib/trades.js';

const trade = (overrides = {}) => ({
  symbol: 'TEST',
  side: 'buy',
  term: 'short',
  quantity: 10,
  entryPrice: 100,
  entryDate: '2026-01-05',
  exitPrice: null,
  exitDate: null,
  ...overrides,
});
const closedOn = (exitDate, exitPrice, overrides) => trade({ exitDate, exitPrice, ...overrides });
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≉ ${expected}`);

describe('realized profit', () => {
  test('a buy gains when it sells higher', () => {
    assert.equal(realizedPnl(closedOn('2026-01-06', 110)), 100);
    assert.equal(realizedPnl(closedOn('2026-01-06', 95)), -50);
  });

  test('a short gains when it is bought back lower', () => {
    assert.equal(realizedPnl(closedOn('2026-01-06', 90, { side: 'short' })), 100);
    assert.equal(realizedPnl(closedOn('2026-01-06', 104, { side: 'short' })), -40);
  });

  test('open trades have realized nothing', () => {
    assert.equal(realizedPnl(trade()), 0);
  });

  test('rounds to cents without float drift', () => {
    assert.equal(pnlCents(closedOn('2026-01-06', 0.3, { quantity: 3, entryPrice: 0.1 })), 60);
    assert.equal(realizedPnl(closedOn('2026-01-06', 170.1, { quantity: 100, entryPrice: 150.05 })), 2005);
  });

  test('return percentage follows the side', () => {
    near(returnPct(closedOn('2026-01-06', 125)), 25);
    near(returnPct(closedOn('2026-01-06', 80, { side: 'short' })), 20);
  });
});

describe('margin', () => {
  test('deepens a loss and shrinks a profit', () => {
    // A $5 loss with $10 margin is a $15 loss.
    assert.equal(realizedPnl(closedOn('2026-01-06', 95, { quantity: 1, margin: 10 })), -15);
    assert.equal(realizedPnl(closedOn('2026-01-06', 120, { quantity: 1, margin: 10 })), 10);
    assert.equal(realizedPnl(closedOn('2026-01-06', 90, { side: 'short', margin: 30 })), 70);
  });

  test('is charged only on the exit that closes the position', () => {
    const position = trade({ quantity: 100, margin: 25 });
    assert.equal(exitPnlCents(position, { exitPrice: 101, quantity: 40 }), 4000);
    assert.equal(exitPnlCents(position, { exitPrice: 101, quantity: 100 }), 7500);
    assert.equal(exitPnlCents(position, { exitPrice: 101, quantity: 100, margin: 30 }), 7000);
  });

  test('return percentage is net of margin', () => {
    near(returnPct(closedOn('2026-01-06', 110, { margin: 20 })), 8);
  });

  test('period totals are net and report the margin paid', () => {
    const summary = summarize(
      [closedOn('2026-09-25', 110, { margin: 15 }), closedOn('2026-09-24', 90, { margin: 5 })],
      '2026-09-28',
    );
    assert.deepEqual([summary.week.pnl, summary.week.margin], [85, 15]);
    assert.deepEqual([summary.month.pnl, summary.month.margin], [-20, 20]);
  });
});

describe('edited profit or loss', () => {
  test('replaces the calculated amount on a closed trade, which stays as it was', () => {
    const edited = closedOn('2026-09-25', 110, { margin: 5, pnlOverride: 93.21 });
    assert.equal(calculatedPnlCents(edited), 9500); // $100 price move − $5 margin
    assert.equal(realizedPnl(edited), 93.21);
    near(returnPct(edited), 9.321);
  });

  test('an open trade has realized nothing, edited or not', () => {
    assert.equal(realizedPnl(trade({ pnlOverride: 50 })), 0);
  });

  test('period totals use the edited amount', () => {
    const summary = summarize([closedOn('2026-09-25', 110, { pnlOverride: -12.5 })], '2026-09-28');
    assert.equal(summary.week.pnl, -12.5);
  });
});

describe('weeks run Friday to Thursday', () => {
  const cases = [
    ['2026-09-25', '2026-09-25', 'Friday starts a week'],
    ['2026-09-26', '2026-09-25', 'Saturday'],
    ['2026-09-28', '2026-09-25', 'Monday'],
    ['2026-10-01', '2026-09-25', 'Thursday ends it'],
    ['2026-10-02', '2026-10-02', 'the next Friday resets'],
    ['2026-12-31', '2026-12-25', 'Thursday before New Year'],
    ['2027-01-03', '2027-01-01', 'across a year boundary'],
  ];
  for (const [today, start, name] of cases) {
    test(`${name}: ${today} → ${start}`, () => assert.equal(weekStart(today), start));
  }

  test('the week ends on the Thursday after it starts', () => {
    assert.equal(weekEnd('2026-09-28'), '2026-10-01');
  });
});

describe('summarize', () => {
  const today = '2026-09-28'; // Monday, so the week began Friday Sep 25
  const trades = [
    closedOn('2026-09-25', 110, { symbol: 'WEEK' }), //                    +100
    closedOn('2026-09-24', 90, { symbol: 'MONTH' }), // previous Thursday   −100
    closedOn('2026-03-10', 80, { symbol: 'YEAR', side: 'short', term: 'long' }), // +200
    closedOn('2025-12-31', 150, { symbol: 'OLD', term: 'mid', entryDate: '2025-06-02' }), // +500
    trade({ symbol: 'OPEN', quantity: 1000 }),
  ];

  test('buckets realized profit by exit date and ignores open trades', () => {
    const summary = summarize(trades, today);
    const periods = ['week', 'month', 'year', 'overall'];
    assert.deepEqual(periods.map((p) => summary[p].pnl), [100, 0, 200, 700]);
    assert.deepEqual(periods.map((p) => summary[p].count), [1, 2, 3, 4]);
    assert.equal(summary.openCount, 1);
    assert.deepEqual([summary.week.from, summary.week.to], ['2026-09-25', '2026-10-01']);
    assert.equal(summary.firstDate, '2025-06-02');
  });

  test('a term filter applies to every period', () => {
    const summary = summarize(filterByTerm(trades, 'long'), today);
    assert.deepEqual(
      ['week', 'month', 'year', 'overall'].map((p) => summary[p].pnl),
      [0, 0, 200, 200],
    );
  });
});

test('sortTrades puts open positions first, then exits newest first', () => {
  const sorted = sortTrades([
    closedOn('2026-09-01', 1, { symbol: 'C1', entryDate: '2026-08-01' }),
    trade({ symbol: 'O1', entryDate: '2026-07-01' }),
    closedOn('2026-09-20', 1, { symbol: 'C2', entryDate: '2026-02-01' }),
    trade({ symbol: 'O2', entryDate: '2026-09-10' }),
  ]);
  assert.deepEqual(sorted.map((t) => t.symbol), ['O2', 'O1', 'C2', 'C1']);
});

describe('exitProblem', () => {
  const position = trade({ quantity: 50, entryDate: '2026-09-10' });
  const exit = { quantity: 20, exitPrice: 12, exitDate: '2026-09-28' };

  test('accepts a partial exit', () => {
    assert.equal(exitProblem(position, exit), null);
  });

  test('asks for the price the way each side names it', () => {
    assert.equal(exitProblem(position, { ...exit, exitPrice: NaN }), 'Enter the sell price.');
    assert.equal(exitProblem({ ...position, side: 'short' }, { ...exit, exitPrice: 0 }), 'Enter the buy price.');
  });

  test('rejects too many shares, early dates, negative margin and closed positions', () => {
    assert.match(exitProblem(position, { ...exit, quantity: 51 }), /only has 50 shares/);
    assert.match(exitProblem(position, { ...exit, exitDate: '2026-09-09' }), /before the entry date/);
    assert.equal(exitProblem(position, { ...exit, margin: -1 }), 'Margin must be $0 or more.');
    assert.match(exitProblem({ ...position, exitPrice: 5, exitDate: '2026-09-11' }, exit), /already closed/);
  });
});

test('isISODate only accepts real calendar dates', () => {
  assert.equal(isISODate('2028-02-29'), true);
  assert.equal(isISODate('2026-02-29'), false);
  assert.equal(isISODate('2026-9-1'), false);
});
