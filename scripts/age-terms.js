// Nightly job (GitHub Actions, 12:05 AM New York time): moves open trades from short to
// mid term after a month, and to long term after a year.
//
//   npm run age-terms                      uses .env (TEST_DB decides the database)
//   npm run age-terms -- --dry-run         lists what would change, saves nothing
//   npm run age-terms -- --today=2026-12-01
import '../server/env.js';
import { connectDb, disconnectDb } from '../server/db.js';
import { isISODate, newYorkDate } from '../server/lib/trades.js';
import { ageOpenTerms } from '../server/jobs/ageTerms.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const today = args.find((arg) => arg.startsWith('--today='))?.split('=')[1] ?? newYorkDate();
if (!isISODate(today)) {
  console.error(`--today must be a date like 2026-11-26, not "${today}".`);
  process.exit(1);
}

try {
  const database = await connectDb();
  console.log(`Database "${database.name}"${database.isTest ? ' (test)' : ''}, New York date ${today}${dryRun ? ', dry run' : ''}.`);
  const changes = await ageOpenTerms(today, { dryRun });
  for (const { symbol, entryDate, from, to } of changes) {
    console.log(`${dryRun ? 'Would move' : 'Moved'} ${symbol} (bought ${entryDate}) from ${from} to ${to} term.`);
  }
  console.log(changes.length ? `${changes.length} open trade(s) ${dryRun ? 'to update' : 'updated'}.` : 'No open trades to move.');
} catch (err) {
  console.error(`Aging terms failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await disconnectDb();
}
