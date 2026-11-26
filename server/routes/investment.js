import { Router } from 'express';
import { loadInvestment, saveInvestment } from '../models/Investment.js';

export const investmentRouter = Router();

// { amount }: the one amount invested across every term.
investmentRouter.get('/', async (req, res) => {
  res.json(await loadInvestment());
});

// Change the amount. An empty value means $0.
investmentRouter.patch('/', async (req, res) => {
  const value = req.body?.amount;
  res.json(await saveInvestment(value === undefined || value === '' || value === null ? 0 : value));
});
