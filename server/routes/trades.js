import { Router } from 'express';
import mongoose from 'mongoose';
import { Trade, toApi } from '../models/Trade.js';
import { HttpError } from '../errors.js';
import {
  closesPosition,
  exitProblem,
  filterByTerm,
  isOpen,
  roundQty,
  sortTrades,
} from '../lib/trades.js';
import { termParam } from './params.js';

export const tradesRouter = Router();

const EDITABLE = [
  'symbol',
  'side',
  'term',
  'quantity',
  'entryPrice',
  'entryDate',
  'exitPrice',
  'exitDate',
  'margin',
  'broker',
  'pnlOverride',
];

// Copy only known fields; an empty string clears a field, and a cleared margin is $0.
// A cleared pnlOverride goes back to the calculated profit or loss.
function pickEditable(body = {}) {
  const fields = {};
  for (const key of EDITABLE) {
    if (body[key] !== undefined) fields[key] = body[key] === '' ? null : body[key];
  }
  if (fields.margin === null) fields.margin = 0;
  return fields;
}

// A broker must be one of BROKERS in .env; none given means the default.
// A trade keeps a code later removed from the list until someone changes it.
function brokerFor(req, value, current) {
  const { codes, defaultBroker } = req.app.locals.brokers;
  const broker = value == null ? defaultBroker : String(value).trim().toUpperCase();
  if (broker !== current && !codes.includes(broker)) {
    throw new HttpError(400, `Broker must be one of ${codes.join(', ')}.`);
  }
  return broker;
}

const view = (req, doc) => toApi(doc, req.app.locals.brokers.defaultBroker);

async function findTrade(id) {
  const trade = mongoose.isValidObjectId(id) ? await Trade.findById(id) : null;
  if (!trade) throw new HttpError(404, 'That transaction no longer exists. Refresh the page.');
  return trade;
}

// Open positions first (newest entry on top), then closed trades by exit date, newest first.
// ?term=short|mid|long narrows the list; missing or "all" returns everything.
tradesRouter.get('/', async (req, res) => {
  const term = termParam(req.query.term);
  const trades = (await Trade.find().lean()).map((doc) => view(req, doc));
  res.json(sortTrades(filterByTerm(trades, term)));
});

tradesRouter.post('/', async (req, res) => {
  const fields = pickEditable(req.body);
  fields.broker = brokerFor(req, fields.broker);
  const trade = await Trade.create(fields);
  res.status(201).json(view(req, trade));
});

tradesRouter.patch('/:id', async (req, res) => {
  const trade = await findTrade(req.params.id);
  const fields = pickEditable(req.body);
  if ('broker' in fields) fields.broker = brokerFor(req, fields.broker, trade.broker);
  trade.set(fields);
  await trade.save();
  res.json(view(req, trade));
});

// Sell a buy, or buy back a short. Exiting fewer shares than the position holds
// splits it: the exited shares become their own closed trade and the rest stays open.
// The margin sent with the exit replaces the position's margin; it is charged only
// on the exit that closes the last shares.
tradesRouter.post('/:id/exit', async (req, res) => {
  const trade = await findTrade(req.params.id);
  const body = req.body ?? {};
  const given = (value) => value != null && value !== '';
  const exit = {
    quantity: given(body.quantity) ? Number(body.quantity) : trade.quantity,
    exitPrice: Number(body.exitPrice),
    exitDate: body.exitDate,
    margin: given(body.margin) ? Number(body.margin) : (trade.margin ?? 0),
  };
  const problem = exitProblem(trade, exit);
  if (problem) throw new HttpError(isOpen(trade) ? 400 : 409, problem);

  if (closesPosition(trade, exit.quantity)) {
    trade.set({ exitPrice: exit.exitPrice, exitDate: exit.exitDate, margin: exit.margin });
    await trade.save();
    return res.json({ closed: view(req, trade), remaining: null });
  }

  // Shrink the open position only if nothing changed it since we read it.
  // It keeps the margin until its last shares close.
  const remainingQty = roundQty(trade.quantity - exit.quantity);
  const remaining = await Trade.findOneAndUpdate(
    { _id: trade._id, exitPrice: null, quantity: trade.quantity },
    { $set: { quantity: remainingQty, margin: exit.margin } },
    { returnDocument: 'after' },
  );
  if (!remaining) {
    throw new HttpError(409, 'This position changed while you were exiting it. Refresh and try again.');
  }

  try {
    const closed = await Trade.create({
      symbol: trade.symbol,
      side: trade.side,
      term: trade.term,
      broker: trade.broker || req.app.locals.brokers.defaultBroker,
      quantity: exit.quantity,
      entryPrice: trade.entryPrice,
      entryDate: trade.entryDate,
      exitPrice: exit.exitPrice,
      exitDate: exit.exitDate,
      margin: 0,
      splitFrom: trade._id,
    });
    res.json({ closed: view(req, closed), remaining: view(req, remaining) });
  } catch (err) {
    // Put the shares and margin back so the open position isn't left short.
    await Trade.updateOne(
      { _id: trade._id, quantity: remainingQty },
      { $set: { quantity: trade.quantity, margin: trade.margin ?? 0 } },
    );
    throw err;
  }
});

tradesRouter.delete('/:id', async (req, res) => {
  const trade = await findTrade(req.params.id);
  await trade.deleteOne();
  res.status(204).end();
});
