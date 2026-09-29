import { HttpError } from '../errors.js';
import { TERMS } from '../lib/trades.js';

const TERM_FILTERS = ['all', ...TERMS];

// The ?term= filter; missing means all terms.
export function termParam(value = 'all') {
  const term = String(value).trim().toLowerCase();
  if (!TERM_FILTERS.includes(term)) {
    throw new HttpError(400, `term must be one of ${TERM_FILTERS.join(', ')}.`);
  }
  return term;
}
