import './env.js';
import { createApp } from './app.js';
import { connectDb } from './db.js';
import { loadBrokers } from './brokers.js';

// API_PORT rather than PORT: dev tools often set PORT for the web server.
const port = Number(process.env.API_PORT) || 4000;
const host = process.env.HOST || '127.0.0.1';

let brokers;
try {
  brokers = loadBrokers();
} catch (err) {
  console.error(`Check .env: ${err.message}`);
  process.exit(1);
}
console.log(
  `Brokers: ${brokers.list.map(({ code, name }) => `${code} (${name})`).join(', ')}; default ${brokers.defaultBroker}.`,
);

// Listen right away; Mongoose holds queries until the database connection is ready,
// so a request that arrives during startup waits instead of failing.
createApp({ brokers }).listen(port, host, (err) => {
  if (err) {
    console.error(`Couldn't start the API on ${host}:${port}: ${err.message}`);
    process.exit(1);
  }
  console.log(`API listening on http://${host === '127.0.0.1' ? 'localhost' : host}:${port}`);
});

try {
  const database = await connectDb();
  console.log(
    `Connected to MongoDB database "${database.name}" (${database.isTest ? 'test data, TEST_DB=true' : 'prod data'}).`,
  );
} catch (err) {
  console.error(`Couldn't connect to MongoDB: ${err.message}`);
  process.exit(1);
}
