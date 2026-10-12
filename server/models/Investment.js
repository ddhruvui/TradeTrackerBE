import mongoose from 'mongoose';
import { TERMS, investedFor } from '../lib/trades.js';

const DOC_ID = 'investment';

const amount = (label) => ({
  type: Number,
  default: 0,
  validate: {
    validator: (value) => Number.isFinite(value) && value >= 0,
    message: `${label} must be $0 or more.`,
  },
});

// How much money is invested in each term, as one document in the settings collection.
// You edit it from the dashboard; All is the sum of the three.
const investmentSchema = new mongoose.Schema(
  {
    _id: { type: String, default: DOC_ID },
    short: amount('Short term investment'),
    mid: amount('Mid term investment'),
    long: amount('Long term investment'),
  },
  { timestamps: true, collection: 'settings' },
);

export const Investment = mongoose.models.Investment ?? mongoose.model('Investment', investmentSchema);

const toApi = (doc) => {
  const investment = Object.fromEntries(TERMS.map((term) => [term, doc?.[term] ?? 0]));
  return { ...investment, all: investedFor(investment, 'all') };
};

export async function loadInvestment() {
  return toApi(await Investment.findById(DOC_ID).lean());
}

// Changes any of short, mid and long; the others keep their amounts.
export async function saveInvestment(changes) {
  const doc = await Investment.findByIdAndUpdate(
    DOC_ID,
    { $set: changes },
    { upsert: true, returnDocument: 'after', runValidators: true, setDefaultsOnInsert: true },
  ).lean();
  return toApi(doc);
}
