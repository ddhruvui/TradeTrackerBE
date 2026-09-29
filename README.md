# Trade Tracker API

The backend for Trade Tracker: an Express + MongoDB API that stores your stock trades, records exits (full or partial), and works out realized profit for this week, this month, this year and overall. The React dashboard lives in [TradeTrackerFE](https://github.com/ddhruvui/TradeTrackerFE).

## Run it

```bash
npm install
cp .env.example .env   # then fill in your values
npm run dev            # API on http://localhost:4000
```

| Script | What it does |
| --- | --- |
| `npm run dev` | API with auto-restart on code or `.env` changes |
| `npm run dev:test` | Same, forced onto the test database |
| `npm start` | API without auto-restart |
| `npm test` | Unit tests + API tests, always on `MONGO_DB_Test` |

`npm test` clears the `trades` collection in `MONGO_DB_Test` before and after it runs. To keep data you've put there, point the run at a throwaway database: `MONGO_DB_Test=SomeScratchDb npm test`.

## Settings (`.env`)

`.env` holds your connection string and password, so it is git-ignored; only `.env.example` is committed.

| Key | Meaning |
| --- | --- |
| `MONGO_URI` | Atlas connection string. A `<db_password>` placeholder is filled from `DB_PASSWORD`. |
| `DB_PASSWORD` | Database password |
| `MONGO_DB` | Real (prod) database |
| `MONGO_DB_Test` | Test database. Must differ from `MONGO_DB`. |
| `TEST_DB` | `true` uses `MONGO_DB_Test`; `false` or missing uses `MONGO_DB`. Any other value stops the server, so a typo can't land on the real data. |
| `BROKERS` | Broker codes and names as JSON in single quotes: `'{"R":"Robinhood","V":"Vanguard","ML":"Merrill Lynch"}'` |
| `DEFAULT_BROKER` | Broker for new trades (optional; the first broker otherwise) |
| `API_PORT`, `HOST` | Optional; default `4000` and `127.0.0.1` |

Saving `.env` while `npm run dev` runs restarts the API with the new values. A shell variable wins over `.env` (`TEST_DB=true npm start`).

## Deploy on Vercel

Vercel runs `index.js` at the repo root as a single function: it exports the Express app instead of listening on a port (locally, `server/index.js` does the listening). In the Vercel project:

1. **Environment variables** (Settings → Environment Variables): `MONGO_URI`, `DB_PASSWORD`, `MONGO_DB`, `MONGO_DB_Test`, `TEST_DB`, `BROKERS`, `DEFAULT_BROKER`, with the same values as your `.env`. Redeploy after changing them.
2. **MongoDB Atlas network access**: Vercel Functions don't have fixed IP addresses, so Atlas has to accept connections from anywhere (Network Access → Add IP Address → 0.0.0.0/0), or use Vercel's MongoDB Atlas integration.

If the database can't be reached, requests get a 503 with a short message, and the reason is written to the function logs.

The API has no login: anyone who knows its URL can read, change and delete trades.

## How the numbers work

- **Entries** are a Buy or a Short at a broker, with a term (Short by default, Mid or Long) and a margin in dollars ($0 by default).
- **Exits**: the sell price for a buy, the buy-back price for a short, and a date. Exiting fewer shares splits the position: the exited shares become their own closed trade (`splitFrom` points at the original) and the rest stays open.
- **Realized profit** counts closed trades only, on their exit date. Buy: (exit − entry) × shares − margin. Short: (entry − exit) × shares − margin. So a $5 loss with $10 margin is −$15.
- **Margin on partial exits** stays with the open part and is charged only when the last shares close.
- **Periods**: weeks run Friday to Thursday and reset every Friday; month and year are calendar periods.
- **Order**: open positions first (newest entry on top), then closed trades by exit date, newest first.

The rules live in `server/lib/trades.js`. The frontend's live exit preview (`src/preview.js` in TradeTrackerFE) mirrors the exit rule, so change both together.

## API

| Method | Path | Body or query |
| --- | --- | --- |
| GET | `/` | Returns the API's name and routes |
| GET | `/api/info` | Returns `{ testDb, brokers, defaultBroker }` |
| GET | `/api/trades` | `?term=all\|short\|mid\|long`. Sorted; closed trades include `realizedPnl`, `returnPct` and `daysHeld`. |
| GET | `/api/summary` | `?term=…&today=YYYY-MM-DD` (the viewer's date). Returns `week`, `month`, `year` and `overall`, each with `pnl`, `margin`, `count` and `from`; `week.to`; `openCount`; `firstDate`. |
| POST | `/api/trades` | `symbol, side (buy/short), term, quantity, entryPrice, entryDate, margin?, broker?` |
| PATCH | `/api/trades/:id` | Any of the fields above, plus `exitPrice, exitDate` (null both to reopen) |
| POST | `/api/trades/:id/exit` | `exitPrice, exitDate, quantity?` (omit for the whole position), `margin?` (replaces the position's margin) |
| DELETE | `/api/trades/:id` | – |

Dates are `YYYY-MM-DD` strings. Errors come back as `{ error, fields? }`.

## Layout

```
index.js          Vercel entry: exports the app, connects on first request
server/
  index.js        local startup: config checks, listen, connect
  app.js          Express app and routes
  lib/trades.js   profit, period, sorting and exit rules
  models/         Mongoose Trade model
  routes/         /api/trades, /api/summary
test/             node:test suites
```
