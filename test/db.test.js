import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDatabase, resolveUri, usesTestDb } from '../server/db.js';

const env = (overrides = {}) => ({
  MONGO_URI: 'mongodb+srv://me:<db_password>@cluster.example.net/?retryWrites=true',
  DB_PASSWORD: 'p@ss/word',
  MONGO_DB: 'Prod',
  MONGO_DB_Test: 'Test',
  ...overrides,
});

describe('TEST_DB switch', () => {
  test('true uses the test database', () => {
    for (const value of ['true', 'TRUE', ' True ', '1']) {
      assert.deepEqual(resolveDatabase(env({ TEST_DB: value })), { name: 'Test', isTest: true });
    }
  });

  test('false or unset uses the prod database', () => {
    for (const value of ['false', 'FALSE', '0', '', undefined]) {
      assert.deepEqual(resolveDatabase(env({ TEST_DB: value })), { name: 'Prod', isTest: false });
    }
  });

  test('a typo is refused instead of falling back to prod', () => {
    assert.throws(() => usesTestDb({ TEST_DB: 'ture' }), /TEST_DB must be true or false/);
    assert.throws(() => usesTestDb({ TEST_DB: 'yes' }), /TEST_DB must be true or false/);
  });

  test('the test database must not be the prod database', () => {
    assert.throws(
      () => resolveDatabase(env({ TEST_DB: 'true', MONGO_DB_Test: 'Prod' })),
      /must name a different database/,
    );
  });

  test('a missing database name is reported by its .env key', () => {
    assert.throws(() => resolveDatabase(env({ TEST_DB: 'true', MONGO_DB_Test: '' })), /MONGO_DB_Test is not set/);
    assert.throws(() => resolveDatabase(env({ MONGO_DB: undefined })), /MONGO_DB is not set/);
  });
});

test('the <db_password> placeholder is filled from DB_PASSWORD, URL-encoded', () => {
  assert.equal(
    resolveUri(env()),
    'mongodb+srv://me:p%40ss%2Fword@cluster.example.net/?retryWrites=true',
  );
});
