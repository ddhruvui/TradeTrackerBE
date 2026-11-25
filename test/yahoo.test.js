import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createYahooPrices, fetchYahooPrice, yahooTickers } from '../server/lib/yahoo.js';

const chart = (price, time = 1795640400) => ({
  ok: true,
  json: async () => ({ chart: { result: [{ meta: { regularMarketPrice: price, regularMarketTime: time } }] } }),
});

describe('Yahoo Finance prices', () => {
  test('VOO and WMT by default; YAHOO_TICKERS overrides, empty turns it off', () => {
    assert.deepEqual(yahooTickers({}), ['VOO', 'WMT']);
    assert.deepEqual(yahooTickers({ YAHOO_TICKERS: ' voo , spy ,' }), ['VOO', 'SPY']);
    assert.deepEqual(yahooTickers({ YAHOO_TICKERS: '' }), []);
  });

  test('reads regularMarketPrice and its quote time', async () => {
    let url;
    const result = await fetchYahooPrice('VOO', async (u) => ((url = u), chart(658.87)));
    assert.match(url, /\/v8\/finance\/chart\/VOO\?/);
    assert.deepEqual(result, { price: 658.87, at: '2026-11-25T21:00:00.000Z' });
  });

  test('bad answers and network errors give null', async () => {
    assert.equal(await fetchYahooPrice('X', async () => ({ ok: false })), null);
    assert.equal(await fetchYahooPrice('X', async () => chart(null)), null);
    assert.equal(await fetchYahooPrice('X', async () => ({ ok: true, json: async () => ({}) })), null);
    assert.equal(
      await fetchYahooPrice('X', async () => {
        throw new Error('offline');
      }),
      null,
    );
  });

  test('caches a full answer; a missed ticker is left out and retried', async () => {
    let calls = 0;
    let wmtUp = false;
    let clock = 0;
    const fetchFn = async (url) => {
      calls++;
      if (url.includes('WMT') && !wmtUp) return { ok: false };
      return chart(url.includes('VOO') ? 600 : 130);
    };
    const load = createYahooPrices({ tickers: ['VOO', 'WMT'], fetchFn, cacheMs: 1000, now: () => clock });

    assert.deepEqual(Object.keys(await load()), ['VOO']);
    wmtUp = true;
    assert.deepEqual(Object.keys(await load()), ['VOO', 'WMT']);
    assert.equal(calls, 4);
    await load(); // cached
    assert.equal(calls, 4);
    clock = 1000;
    await load(); // expired
    assert.equal(calls, 6);
  });
});
