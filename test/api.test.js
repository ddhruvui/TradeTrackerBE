import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import mongoose from 'mongoose';
import '../server/env.js';
import { connectDb, disconnectDb } from '../server/db.js';
import { createApp } from '../server/app.js';
import { Trade } from '../server/models/Trade.js';
import { realizedPnl } from '../server/lib/trades.js';

// These tests write to MongoDB and clear it, so they force MONGO_DB_Test
// whatever TEST_DB says in .env. The broker list is pinned so edits to .env can't break them.
process.env.TEST_DB = 'true';
process.env.BROKERS = '{"R":"Robinhood","V":"Vanguard","ML":"Merrill Lynch"}';
process.env.DEFAULT_BROKER = 'R';

let server;
let baseUrl;

before(async () => {
  const database = await connectDb();
  assert.equal(database.name, process.env.MONGO_DB_Test);
  assert.equal(mongoose.connection.db.databaseName, process.env.MONGO_DB_Test);
  server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

beforeEach(() => Trade.deleteMany({}));

after(async () => {
  if (mongoose.connection.readyState === 1) await Trade.deleteMany({});
  server?.close();
  await disconnectDb();
});

async function call(method, path, body) {
  const res = await fetch(baseUrl + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
}

const addBuy = (overrides = {}) =>
  call('POST', '/trades', {
    symbol: 'NVDA',
    side: 'buy',
    quantity: 100,
    entryPrice: 50,
    entryDate: '2026-09-01',
    ...overrides,
  });

describe('trades API', () => {
  test('adds a buy with short term and $0 margin as the defaults', async () => {
    const { status, body } = await addBuy({ symbol: ' aapl ' });
    assert.equal(status, 201);
    assert.equal(body.symbol, 'AAPL');
    assert.equal(body.term, 'short');
    assert.equal(body.margin, 0);
    assert.equal(body.exitPrice, null);
  });

  test('margin turns a $5 loss into a $15 loss', async () => {
    const { body: position } = await addBuy({ quantity: 1, entryPrice: 100, margin: 10 });
    const { body } = await call('POST', `/trades/${position.id}/exit`, {
      exitPrice: 95,
      exitDate: '2026-09-28',
    });
    assert.equal(body.closed.margin, 10);
    assert.equal(realizedPnl(body.closed), -15);
  });

  test('margin stays with the open part until the last shares close', async () => {
    const { body: position } = await addBuy({ quantity: 100, entryPrice: 50, margin: 10 });
    const path = `/trades/${position.id}/exit`;

    // Partial exit with the margin raised to $12: none of it is charged yet.
    const first = await call('POST', path, {
      quantity: 40,
      exitPrice: 51,
      exitDate: '2026-09-25',
      margin: 12,
    });
    assert.equal(first.body.closed.margin, 0);
    assert.equal(realizedPnl(first.body.closed), 40);
    assert.equal(first.body.remaining.margin, 12);

    // Final exit: the whole $12 comes off this exit's profit.
    const last = await call('POST', path, { exitPrice: 51, exitDate: '2026-09-28' });
    assert.equal(last.body.closed.margin, 12);
    assert.equal(realizedPnl(last.body.closed), 60 - 12);
  });

  test('rejects a negative margin', async () => {
    const bad = await addBuy({ margin: -1 });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, 'Margin must be $0 or more.');

    const { body: position } = await addBuy();
    const exit = await call('POST', `/trades/${position.id}/exit`, {
      exitPrice: 60,
      exitDate: '2026-09-28',
      margin: -5,
    });
    assert.equal(exit.status, 400);
    assert.equal(exit.body.error, 'Margin must be $0 or more.');
  });

  test('explains what is wrong with a bad entry', async () => {
    const zero = await addBuy({ quantity: 0 });
    assert.equal(zero.status, 400);
    assert.equal(zero.body.error, 'Quantity must be greater than 0.');

    const bad = await call('POST', '/trades', {
      symbol: '',
      side: 'hold',
      quantity: 'ten',
      entryPrice: 5,
      entryDate: '2026-02-30',
    });
    assert.equal(bad.status, 400);
    assert.deepEqual(Object.keys(bad.body.fields).sort(), ['entryDate', 'quantity', 'side', 'symbol']);
    assert.equal(bad.body.fields.quantity, 'Quantity must be a number.');
  });

  test('selling part of a buy splits it and leaves the rest open', async () => {
    const { body: position } = await addBuy({ term: 'mid' });
    const { status, body } = await call('POST', `/trades/${position.id}/exit`, {
      quantity: 40,
      exitPrice: 60,
      exitDate: '2026-09-25',
    });
    assert.equal(status, 200);
    assert.equal(body.closed.quantity, 40);
    assert.equal(body.closed.exitPrice, 60);
    assert.equal(body.closed.term, 'mid');
    assert.equal(body.closed.splitFrom, position.id);
    assert.equal(realizedPnl(body.closed), 400);
    assert.equal(body.remaining.id, position.id);
    assert.equal(body.remaining.quantity, 60);
    assert.equal(body.remaining.exitPrice, null);

    const { body: list } = await call('GET', '/trades');
    assert.deepEqual(
      list.map((t) => [t.quantity, t.exitPrice]),
      [
        [60, null],
        [40, 60],
      ],
    );
  });

  test('buying back part of a short works the same way', async () => {
    const { body: short } = await addBuy({ symbol: 'TSLA', side: 'short', quantity: 30, entryPrice: 250 });
    const { body } = await call('POST', `/trades/${short.id}/exit`, {
      quantity: 10,
      exitPrice: 230,
      exitDate: '2026-09-28',
    });
    assert.equal(body.closed.quantity, 10);
    assert.equal(body.remaining.quantity, 20);
    assert.equal(realizedPnl(body.closed), 200);
  });

  test('exiting every share closes the position in place', async () => {
    const { body: position } = await addBuy({ quantity: 10 });
    const { body } = await call('POST', `/trades/${position.id}/exit`, {
      exitPrice: 45,
      exitDate: '2026-09-28',
    });
    assert.equal(body.remaining, null);
    assert.equal(body.closed.id, position.id);
    assert.equal(realizedPnl(body.closed), -50);
  });

  test('refuses exits that do not add up', async () => {
    const { body: position } = await addBuy({ quantity: 10, entryDate: '2026-09-10' });
    const path = `/trades/${position.id}/exit`;

    const tooMany = await call('POST', path, { quantity: 11, exitPrice: 60, exitDate: '2026-09-28' });
    assert.equal(tooMany.status, 400);
    assert.match(tooMany.body.error, /only has 10 shares/);

    const early = await call('POST', path, { exitPrice: 60, exitDate: '2026-09-09' });
    assert.match(early.body.error, /before the entry date/);

    const noPrice = await call('POST', path, { exitDate: '2026-09-28' });
    assert.equal(noPrice.body.error, 'Enter the sell price.');

    await call('POST', path, { exitPrice: 60, exitDate: '2026-09-28' });
    const again = await call('POST', path, { exitPrice: 61, exitDate: '2026-09-28' });
    assert.equal(again.status, 409);
  });

  test('edits, reopens and deletes a transaction', async () => {
    const { body: position } = await addBuy();
    await call('POST', `/trades/${position.id}/exit`, { exitPrice: 55, exitDate: '2026-09-20' });

    const edited = await call('PATCH', `/trades/${position.id}`, {
      term: 'long',
      exitPrice: 56,
      margin: 3,
    });
    assert.equal(edited.status, 200);
    assert.deepEqual([edited.body.term, edited.body.exitPrice, edited.body.margin], ['long', 56, 3]);

    const clearedMargin = await call('PATCH', `/trades/${position.id}`, { margin: '' });
    assert.equal(clearedMargin.body.margin, 0);

    const halfCleared = await call('PATCH', `/trades/${position.id}`, { exitPrice: null });
    assert.equal(halfCleared.status, 400);

    const reopened = await call('PATCH', `/trades/${position.id}`, { exitPrice: null, exitDate: null });
    assert.equal(reopened.body.exitPrice, null);

    assert.equal((await call('DELETE', `/trades/${position.id}`)).status, 204);
    assert.equal((await call('DELETE', `/trades/${position.id}`)).status, 404);
    assert.deepEqual((await call('GET', '/trades')).body, []);
  });

  test('reports the test database and the broker list from .env', async () => {
    assert.deepEqual((await call('GET', '/info')).body, {
      testDb: true,
      brokers: [
        { code: 'R', name: 'Robinhood' },
        { code: 'V', name: 'Vanguard' },
        { code: 'ML', name: 'Merrill Lynch' },
      ],
      defaultBroker: 'R',
    });
  });

  test('a trade gets the default broker unless one is chosen', async () => {
    assert.equal((await addBuy()).body.broker, 'R');
    assert.equal((await addBuy({ broker: 'ml' })).body.broker, 'ML');

    const unknown = await addBuy({ broker: 'E' });
    assert.equal(unknown.status, 400);
    assert.equal(unknown.body.error, 'Broker must be one of R, V, ML.');
  });

  test('the broker can be changed and survives a partial exit', async () => {
    const { body: position } = await addBuy({ broker: 'V' });
    const moved = await call('PATCH', `/trades/${position.id}`, { broker: 'ML' });
    assert.equal(moved.body.broker, 'ML');

    const { body } = await call('POST', `/trades/${position.id}/exit`, {
      quantity: 10,
      exitPrice: 55,
      exitDate: '2026-09-28',
    });
    assert.equal(body.closed.broker, 'ML');
    assert.equal(body.remaining.broker, 'ML');

    const bad = await call('PATCH', `/trades/${position.id}`, { broker: 'XX' });
    assert.equal(bad.status, 400);
  });

  test('trades saved before brokers existed show the default broker', async () => {
    const legacy = await Trade.collection.insertOne({
      symbol: 'OLD',
      side: 'buy',
      term: 'short',
      quantity: 1,
      entryPrice: 10,
      entryDate: '2026-01-02',
      exitPrice: null,
      exitDate: null,
    });
    const { body: list } = await call('GET', '/trades');
    assert.equal(list.find((t) => t.id === String(legacy.insertedId)).broker, 'R');
  });

  test('lists one term at a time, with profit worked out on closed trades', async () => {
    const { body: open } = await addBuy({ symbol: 'AAA' });
    const { body: mid } = await addBuy({
      symbol: 'BBB',
      term: 'mid',
      quantity: 10,
      entryPrice: 50,
      margin: 5,
    });
    await call('POST', `/trades/${mid.id}/exit`, { exitPrice: 55, exitDate: '2026-09-11' });

    const midOnly = await call('GET', '/trades?term=mid');
    assert.deepEqual(midOnly.body.map((t) => t.symbol), ['BBB']);
    const [closed] = midOnly.body;
    assert.deepEqual([closed.realizedPnl, closed.returnPct, closed.daysHeld], [45, 9, 10]);

    const all = await call('GET', '/trades');
    const stillOpen = all.body.find((t) => t.id === open.id);
    assert.deepEqual([stillOpen.realizedPnl, stillOpen.returnPct, stillOpen.daysHeld], [null, null, null]);

    const bad = await call('GET', '/trades?term=weekly');
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, 'term must be one of all, short, mid, long.');
  });

  test('totals realized profit per period for the viewer’s date', async () => {
    const { body: thisWeek } = await addBuy({ quantity: 10, entryPrice: 50 });
    await call('POST', `/trades/${thisWeek.id}/exit`, {
      exitPrice: 60,
      exitDate: '2026-09-25',
      margin: 4,
    }); // +$100 − $4 margin
    const { body: thisMonth } = await addBuy({ quantity: 10, entryPrice: 50, term: 'long' });
    await call('POST', `/trades/${thisMonth.id}/exit`, { exitPrice: 45, exitDate: '2026-09-10' }); // −$50
    await addBuy(); // open: never counted

    // Monday Sep 28 2026: the week runs Friday Sep 25 to Thursday Oct 1.
    const { status, body } = await call('GET', '/summary?today=2026-09-28');
    assert.equal(status, 200);
    assert.deepEqual([body.week.from, body.week.to], ['2026-09-25', '2026-10-01']);
    assert.deepEqual(
      ['week', 'month', 'year', 'overall'].map((period) => body[period].pnl),
      [96, 46, 46, 46],
    );
    assert.deepEqual([body.week.margin, body.week.count, body.openCount], [4, 1, 1]);

    const longTerm = await call('GET', '/summary?today=2026-09-28&term=long');
    assert.deepEqual([longTerm.body.week.pnl, longTerm.body.month.pnl], [0, -50]);

    assert.equal((await call('GET', '/summary?today=2026-02-30')).status, 400);
    assert.equal((await call('GET', '/summary?term=weekly')).status, 400);
  });

  test('the final profit or loss of a closed trade can be edited', async () => {
    const { body: position } = await addBuy({ quantity: 10, entryPrice: 50, margin: 2 });
    const path = `/trades/${position.id}`;
    await call('POST', `${path}/exit`, { exitPrice: 60, exitDate: '2026-09-25' }); // $100 − $2 = $98

    const edited = await call('PATCH', path, { pnlOverride: 97.35 });
    assert.equal(edited.status, 200);
    assert.deepEqual(
      [edited.body.realizedPnl, edited.body.calculatedPnl, edited.body.pnlOverride],
      [97.35, 98, 97.35],
    );

    // A later price change keeps the edited amount; clearing it goes back to the calculation.
    const repriced = await call('PATCH', path, { exitPrice: 61 });
    assert.deepEqual([repriced.body.realizedPnl, repriced.body.calculatedPnl], [97.35, 108]);
    const cleared = await call('PATCH', path, { pnlOverride: null });
    assert.deepEqual([cleared.body.realizedPnl, cleared.body.pnlOverride], [108, null]);

    await call('PATCH', path, { pnlOverride: -20 });
    const { body: summary } = await call('GET', '/summary?today=2026-09-28');
    assert.equal(summary.week.pnl, -20);

    // Reopening drops the edited amount: an open trade has realized nothing.
    const reopened = await call('PATCH', path, { exitPrice: null, exitDate: null });
    assert.deepEqual([reopened.body.pnlOverride, reopened.body.realizedPnl], [null, null]);

    const bad = await call('PATCH', path, {
      exitPrice: 60,
      exitDate: '2026-09-25',
      pnlOverride: 'lots',
    });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, 'Realized P&L must be a number.');
  });

  test('unknown ids get a 404', async () => {
    assert.equal((await call('PATCH', '/trades/not-an-id', { term: 'mid' })).status, 404);
  });
});
