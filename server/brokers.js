// Brokers come from .env:
//   BROKERS='{"R":"Robinhood","V":"Vanguard","ML":"Merrill Lynch"}'   short code → name
//   DEFAULT_BROKER=R                                                  optional, else the first
const FALLBACK = { R: 'Robinhood', V: 'Vanguard', ML: 'Merrill Lynch' };
const CODE = /^[A-Z0-9]{1,6}$/;

export function loadBrokers(env = process.env) {
  let config = FALLBACK;
  if (env.BROKERS?.trim()) {
    try {
      config = JSON.parse(env.BROKERS);
    } catch {
      throw new Error(
        `BROKERS in .env must be a JSON object in single quotes, like BROKERS='{"R":"Robinhood"}'.`,
      );
    }
  }
  if (!config || typeof config !== 'object' || Array.isArray(config) || !Object.keys(config).length) {
    throw new Error('BROKERS in .env must list at least one broker, like {"R":"Robinhood"}.');
  }

  const list = [];
  for (const [rawCode, rawName] of Object.entries(config)) {
    const code = rawCode.trim().toUpperCase();
    const name = String(rawName ?? '').trim();
    if (!CODE.test(code)) {
      throw new Error(`Broker code "${rawCode}" in BROKERS must be 1–6 letters or digits.`);
    }
    if (!name) throw new Error(`Broker ${code} in BROKERS needs a name.`);
    if (list.some((broker) => broker.code === code)) {
      throw new Error(`Broker code ${code} appears twice in BROKERS.`);
    }
    list.push({ code, name });
  }

  const codes = list.map((broker) => broker.code);
  const defaultBroker = env.DEFAULT_BROKER?.trim().toUpperCase() || codes[0];
  if (!codes.includes(defaultBroker)) {
    throw new Error(`DEFAULT_BROKER=${defaultBroker} isn't one of the BROKERS (${codes.join(', ')}).`);
  }
  return { list, codes, defaultBroker };
}
