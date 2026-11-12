import mongoose from 'mongoose';

const DOC_ID = 'latest';

// The last price of each stock lives outside the trades database: one document,
// { _id: 'latest', uploadedAt, values: [{ ticker, price }] }, in the LastPrice
// collection of the LastPrice database on the same cluster (something else uploads it).
// LAST_PRICE_DB names another database; the tests use it to stay off the real prices.
export const lastPriceDbName = (env = process.env) => env.LAST_PRICE_DB?.trim() || 'LastPrice';

export const lastPriceCollection = () =>
  mongoose.connection.useDb(lastPriceDbName(), { useCache: true }).collection('LastPrice');

// { uploadedAt, prices: { NVDA: 163.44, … } }; no upload yet gives no prices.
export async function loadLastPrices() {
  const doc = await lastPriceCollection().findOne({ _id: DOC_ID });
  const prices = {};
  for (const { ticker, price } of doc?.values ?? []) {
    const symbol = String(ticker ?? '').trim().toUpperCase();
    if (symbol && Number.isFinite(price) && price > 0) prices[symbol] = price;
  }
  return { uploadedAt: doc?.uploadedAt ?? null, prices };
}
