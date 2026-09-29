import mongoose from 'mongoose';

const PASSWORD_PLACEHOLDER = /<(?:db_)?password>/i;

// TEST_DB=true (in .env or the shell) switches to MONGO_DB_Test; false or unset uses MONGO_DB.
// Anything else is refused, so a typo can't silently land on the real database.
export function usesTestDb(env = process.env) {
  const flag = String(env.TEST_DB ?? '').trim().toLowerCase();
  if (flag === 'true' || flag === '1') return true;
  if (flag === 'false' || flag === '0' || flag === '') return false;
  throw new Error(`TEST_DB must be true or false, not "${env.TEST_DB}".`);
}

export function resolveDatabase(env = process.env) {
  const isTest = usesTestDb(env);
  const key = isTest ? 'MONGO_DB_Test' : 'MONGO_DB';
  const name = env[key]?.trim();
  if (!name) throw new Error(`${key} is not set. Add it to .env or the host's environment variables.`);
  if (isTest && name === env.MONGO_DB?.trim()) {
    throw new Error('MONGO_DB_Test must name a different database than MONGO_DB.');
  }
  return { name, isTest };
}

// Atlas connection strings carry a <db_password> placeholder; fill it from DB_PASSWORD.
export function resolveUri(env = process.env) {
  const uri = env.MONGO_URI?.trim();
  if (!uri) throw new Error("MONGO_URI is not set. Add it to .env or the host's environment variables.");
  if (!PASSWORD_PLACEHOLDER.test(uri)) return uri;
  if (!env.DB_PASSWORD) {
    throw new Error('MONGO_URI contains <db_password> but DB_PASSWORD is not set.');
  }
  const password = encodeURIComponent(env.DB_PASSWORD);
  return uri.replace(PASSWORD_PLACEHOLDER, () => password);
}

export async function connectDb(env = process.env) {
  const database = resolveDatabase(env);
  await mongoose.connect(resolveUri(env), {
    dbName: database.name,
    serverSelectionTimeoutMS: 10_000,
  });
  return database;
}

export const disconnectDb = () => mongoose.disconnect();
