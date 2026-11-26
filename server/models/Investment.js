import mongoose from 'mongoose';

const DOC_ID = 'investment';
const LEGACY_TERMS = ['short', 'mid', 'long'];

// The one amount invested across every term, as one document in the settings collection.
// You edit it from the dashboard; every view's profit % is measured against it.
const investmentSchema = new mongoose.Schema(
  {
    _id: { type: String, default: DOC_ID },
    amount: {
      type: Number,
      validate: {
        validator: (value) => Number.isFinite(value) && value >= 0,
        message: 'Investment must be $0 or more.',
      },
    },
  },
  { timestamps: true, collection: 'settings', strict: false },
);

export const Investment = mongoose.models.Investment ?? mongoose.model('Investment', investmentSchema);

// Documents saved before there was a single amount kept one per term; their sum stands in
// until the amount is saved again.
const toApi = (doc) => ({
  amount: doc?.amount ?? LEGACY_TERMS.reduce((sum, term) => sum + (doc?.[term] ?? 0), 0),
});

export async function loadInvestment() {
  return toApi(await Investment.findById(DOC_ID).lean());
}

export async function saveInvestment(amount) {
  const unset = Object.fromEntries(LEGACY_TERMS.map((term) => [term, '']));
  const doc = await Investment.findByIdAndUpdate(
    DOC_ID,
    { $set: { amount }, $unset: unset },
    { upsert: true, returnDocument: 'after', runValidators: true, setDefaultsOnInsert: true, strict: false },
  ).lean();
  return toApi(doc);
}
