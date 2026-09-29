import express from 'express';
import { tradesRouter } from './routes/trades.js';
import { summaryRouter } from './routes/summary.js';
import { errorHandler } from './errors.js';
import { usesTestDb } from './db.js';
import { loadBrokers } from './brokers.js';

export function createApp({ brokers = loadBrokers() } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));
  app.locals.brokers = brokers;

  // What the UI needs from .env: the broker list and whether this is the test database.
  app.get('/api/info', (req, res) =>
    res.json({
      testDb: usesTestDb(),
      brokers: brokers.list,
      defaultBroker: brokers.defaultBroker,
    }),
  );
  app.use('/api/trades', tradesRouter);
  app.use('/api/summary', summaryRouter);
  app.use('/api', (req, res) => res.status(404).json({ error: 'Unknown API route.' }));

  // Opening the bare URL (for example the Vercel domain) shows what's here.
  app.get('/', (req, res) =>
    res.json({ name: 'Trade Tracker API', routes: ['/api/info', '/api/trades', '/api/summary'] }),
  );
  app.use((req, res) => res.status(404).json({ error: 'Not found. The API lives under /api.' }));

  app.use(errorHandler);
  return app;
}
