import { Router } from 'express';
import { loadInvestment, saveInvestment } from '../models/Investment.js';
import { TERMS } from '../lib/trades.js';

export const investmentRouter = Router();

// { short, mid, long, all }: the amount invested in each term, and their sum.
investmentRouter.get('/', async (req, res) => {
  res.json(await loadInvestment());
});

// Change any of short, mid and long. An empty value means $0.
investmentRouter.patch('/', async (req, res) => {
  const changes = {};
  for (const term of TERMS) {
    const value = req.body?.[term];
    if (value !== undefined) changes[term] = value === '' || value === null ? 0 : value;
  }
  res.json(await saveInvestment(changes));
});
