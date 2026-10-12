import { Router } from 'express';
import { Trade, toApi } from '../models/Trade.js';
import { loadInvestment } from '../models/Investment.js';
import { HttpError } from '../errors.js';
import {
  filterByTerm,
  investedFor,
  isISODate,
  localISODate,
  pctOf,
  summarize,
} from '../lib/trades.js';
import { termParam } from './params.js';

export const summaryRouter = Router();

const PERIODS = ['week', 'month', 'year', 'overall'];

// Realized profit for this week (Friday to Thursday), this month, this year and overall,
// each also as a percentage of the money invested in the view (one term, or all three).
// Pass ?today= as the viewer's local date so periods roll over on their calendar;
// without it the server's date is used.
summaryRouter.get('/', async (req, res) => {
  const term = termParam(req.query.term);
  const today = req.query.today ?? localISODate();
  if (!isISODate(today)) throw new HttpError(400, 'today must be a date like 2026-09-28.');

  const [docs, investment] = await Promise.all([Trade.find().lean(), loadInvestment()]);
  const trades = docs.map((doc) => toApi(doc));
  const totals = summarize(filterByTerm(trades, term), today);
  const invested = investedFor(investment, term);
  for (const period of PERIODS) {
    totals[period].pctOfInvestment = pctOf(totals[period].pnl, invested);
  }
  res.json({ term, today, investment, invested, ...totals });
});
