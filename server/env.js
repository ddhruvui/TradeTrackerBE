// Loads .env from the project root. Variables already set in the shell win.
import { fileURLToPath } from 'node:url';

const envFile = fileURLToPath(new URL('../.env', import.meta.url));

try {
  process.loadEnvFile(envFile);
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
}
