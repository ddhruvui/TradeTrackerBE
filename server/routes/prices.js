import { Router } from 'express';
import { loadLastPrices } from '../models/LastPrice.js';

export const pricesRouter = Router();

// { uploadedAt, prices: { TICKER: lastPrice }, live: { TICKER: quoteTime } }: the latest upload
// to the LastPrice database, with Yahoo Finance's live prices (VOO, WMT) on top of it.
// live says which prices came from Yahoo and when Yahoo quoted them.
pricesRouter.get('/', async (req, res) => {
  const [upload, yahoo] = await Promise.all([
    loadLastPrices(),
    req.app.locals.livePrices().catch(() => ({})),
  ]);
  const prices = { ...upload.prices };
  const live = {};
  for (const [ticker, { price, at }] of Object.entries(yahoo)) {
    prices[ticker] = price;
    live[ticker] = at;
  }
  res.json({ ...upload, prices, live });
});
