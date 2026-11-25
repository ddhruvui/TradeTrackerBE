// Live prices from Yahoo Finance for the tickers the LastPrice upload doesn't keep
// fresh (VOO and WMT by default; YAHOO_TICKERS overrides, comma-separated, empty turns it off).
// Results are cached for a few minutes, and a ticker Yahoo can't answer is simply left out,
// so /api/prices still works when Yahoo is slow or down.

const CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const CACHE_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 4000;

export const yahooTickers = (env = process.env) =>
  (env.YAHOO_TICKERS ?? 'VOO,WMT')
    .split(',')
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean);

// One ticker's { price, at } or null.
export async function fetchYahooPrice(ticker, fetchFn = fetch) {
  try {
    const res = await fetchFn(`${CHART_URL}${encodeURIComponent(ticker)}?range=1d&interval=1d`, {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const meta = (await res.json())?.chart?.result?.[0]?.meta;
    const price = meta?.regularMarketPrice;
    if (!Number.isFinite(price) || price <= 0) return null;
    const at = Number.isFinite(meta.regularMarketTime)
      ? new Date(meta.regularMarketTime * 1000).toISOString()
      : new Date().toISOString();
    return { price, at };
  } catch {
    return null;
  }
}

// A cached loader: () => { TICKER: { price, at } } for the tickers Yahoo answered.
export function createYahooPrices({ tickers = yahooTickers(), fetchFn = fetch, cacheMs = CACHE_MS, now = Date.now } = {}) {
  let cached = null;
  let cachedAt = 0;
  let pending = null;
  return async function yahooPrices() {
    if (!tickers.length) return {};
    if (cached && now() - cachedAt < cacheMs) return cached;
    pending ??= Promise.all(tickers.map((t) => fetchYahooPrice(t, fetchFn)))
      .then((results) => {
        const prices = {};
        results.forEach((r, i) => r && (prices[tickers[i]] = r));
        // Only cache a full answer, so a missed ticker is tried again on the next read.
        if (Object.keys(prices).length === tickers.length) {
          cached = prices;
          cachedAt = now();
        }
        return prices;
      })
      .finally(() => (pending = null));
    return pending;
  };
}
