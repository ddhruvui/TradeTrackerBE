import { Router } from 'express';
import { Trade, toApi } from '../models/Trade.js';
import { HttpError } from '../errors.js';
import { filterByTerm, isISODate, localISODate, summarize } from '../lib/trades.js';
import { termParam } from './params.js';

export const summaryRouter = Router();

// Realized profit for this week (Friday to Thursday), this month, this year and overall.
// Pass ?today= as the viewer's local date so periods roll over on their calendar;
// without it the server's date is used.
summaryRouter.get('/', async (req, res) => {
  const term = termParam(req.query.term);
  const today = req.query.today ?? localISODate();
  if (!isISODate(today)) throw new HttpError(400, 'today must be a date like 2026-09-28.');

  const trades = (await Trade.find().lean()).map((doc) => toApi(doc));
  res.json({ term, today, ...summarize(filterByTerm(trades, term), today) });
});
