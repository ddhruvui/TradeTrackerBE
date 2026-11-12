import { Router } from 'express';
import { loadLastPrices } from '../models/LastPrice.js';

export const pricesRouter = Router();

// { uploadedAt, prices: { TICKER: lastPrice } }: the latest upload to the LastPrice database.
pricesRouter.get('/', async (req, res) => {
  res.json(await loadLastPrices());
});
