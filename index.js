// Entry point for Vercel, which runs this file as a single Function (it looks for
// index.js at the project root) and serves the Express app it exports.
// Locally, `npm run dev` and `npm start` run server/index.js, which listens on API_PORT.
import express from 'express';
import './server/env.js';
import { createApp } from './server/app.js';
import { connectDb } from './server/db.js';

const DATABASE_DOWN =
  'The API can’t reach its database. Check the deployment’s environment variables and MongoDB Atlas network access.';

// Connect once per instance and share the connection across requests.
// A failed attempt is retried on the next request instead of sticking.
let connection = null;
function ensureConnected() {
  connection ??= connectDb().catch((err) => {
    connection = null;
    throw err;
  });
  return connection;
}

async function requireDatabase(req, res, next) {
  try {
    await ensureConnected();
    next();
  } catch (err) {
    console.error(`Couldn't connect to MongoDB: ${err.message}`);
    res.status(503).json({ error: DATABASE_DOWN });
  }
}

const app = express();
app.disable('x-powered-by');
app.use(createApp({ beforeRoutes: [requireDatabase] }));

export default app;
