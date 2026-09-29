import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadBrokers } from '../server/brokers.js';

const JSON_CONFIG = '{"R":"Robinhood","V":"Vanguard","ML":"Merrill Lynch"}';

test('reads BROKERS and DEFAULT_BROKER from .env', () => {
  const brokers = loadBrokers({ BROKERS: JSON_CONFIG, DEFAULT_BROKER: 'v' });
  assert.deepEqual(brokers.codes, ['R', 'V', 'ML']);
  assert.deepEqual(brokers.list[2], { code: 'ML', name: 'Merrill Lynch' });
  assert.equal(brokers.defaultBroker, 'V');
});

test('the first broker is the default when DEFAULT_BROKER is missing', () => {
  assert.equal(loadBrokers({ BROKERS: '{"ml":"Merrill Lynch","R":"Robinhood"}' }).defaultBroker, 'ML');
});

test('falls back to R, V and ML with R as default when BROKERS is missing', () => {
  const brokers = loadBrokers({});
  assert.deepEqual(brokers.codes, ['R', 'V', 'ML']);
  assert.equal(brokers.defaultBroker, 'R');
});

test('accepts the value with its single quotes, as pasted into a hosting dashboard', () => {
  assert.deepEqual(loadBrokers({ BROKERS: `'${JSON_CONFIG}'` }).codes, ['R', 'V', 'ML']);
});

test('explains a broken config instead of starting with it', () => {
  assert.throws(() => loadBrokers({ BROKERS: '{R:Robinhood}' }), /must be a JSON object/);
  assert.throws(() => loadBrokers({ BROKERS: '{}' }), /at least one broker/);
  assert.throws(() => loadBrokers({ BROKERS: '["R"]' }), /at least one broker/);
  assert.throws(() => loadBrokers({ BROKERS: '{"R S":"Robinhood"}' }), /1–6 letters or digits/);
  assert.throws(() => loadBrokers({ BROKERS: '{"R":""}' }), /needs a name/);
  assert.throws(() => loadBrokers({ BROKERS: '{"R":"A","r":"B"}' }), /appears twice/);
  assert.throws(() => loadBrokers({ BROKERS: JSON_CONFIG, DEFAULT_BROKER: 'E' }), /isn't one of the BROKERS/);
});
