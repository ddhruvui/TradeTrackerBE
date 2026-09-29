import mongoose from 'mongoose';
import {
  SIDES,
  TERMS,
  calculatedPnlCents,
  daysBetween,
  isISODate,
  realizedPnl,
  returnPct,
} from '../lib/trades.js';

const positive = (label) => ({
  validator: (value) => value == null || (Number.isFinite(value) && value > 0),
  message: `${label} must be greater than 0.`,
});

const zeroOrMore = (label) => ({
  validator: (value) => value == null || (Number.isFinite(value) && value >= 0),
  message: `${label} must be $0 or more.`,
});

const calendarDate = (label) => ({
  validator: (value) => value == null || isISODate(value),
  message: `${label} must be a real date (YYYY-MM-DD).`,
});

const tradeSchema = new mongoose.Schema(
  {
    symbol: {
      type: String,
      required: [true, 'Enter a stock symbol.'],
      trim: true,
      uppercase: true,
      maxlength: [15, 'Stock symbols are at most 15 characters.'],
    },
    side: {
      type: String,
      required: [true, 'Choose Buy or Short.'],
      enum: { values: SIDES, message: 'Type must be Buy or Short.' },
    },
    term: {
      type: String,
      default: 'short',
      enum: { values: TERMS, message: 'Term must be short, mid or long.' },
    },
    quantity: { type: Number, required: [true, 'Enter a quantity.'], validate: positive('Quantity') },
    entryPrice: { type: Number, required: [true, 'Enter a price.'], validate: positive('Price') },
    entryDate: { type: String, required: [true, 'Enter a date.'], validate: calendarDate('Date') },
    // Sell price for a buy, buy-back price for a short. Null while the position is open.
    exitPrice: { type: Number, default: null, validate: positive('Exit price') },
    exitDate: { type: String, default: null, validate: calendarDate('Exit date') },
    // Margin in dollars. It comes off realized profit when the last shares close;
    // on a partial exit it stays with the open part.
    margin: { type: Number, default: 0, validate: zeroOrMore('Margin') },
    // Short code of the broker holding the trade, one of BROKERS in .env (checked by the routes).
    broker: { type: String, trim: true, uppercase: true, maxlength: 6 },
    // Final realized profit or loss typed in for a closed trade. It replaces the
    // calculated amount; null means use the calculation.
    pnlOverride: {
      type: Number,
      default: null,
      validate: {
        validator: (value) => value == null || Number.isFinite(value),
        message: 'Realized P&L must be a number.',
      },
    },
    // Set on the closed part of a partial exit; points at the position it came from.
    splitFrom: { type: mongoose.Schema.Types.ObjectId, default: null },
  },
  { timestamps: true },
);

tradeSchema.pre('validate', function () {
  // A reopened trade has realized nothing, so an edited amount no longer applies.
  if (this.exitPrice == null && this.exitDate == null) this.pnlOverride = null;

  const hasPrice = this.exitPrice != null;
  const hasDate = this.exitDate != null;
  if (hasPrice !== hasDate) {
    this.invalidate(
      hasPrice ? 'exitDate' : 'exitPrice',
      'Enter both the exit price and the exit date, or leave both empty.',
    );
  } else if (hasDate && this.entryDate && this.exitDate < this.entryDate) {
    this.invalidate('exitDate', 'The exit date can’t be before the entry date.');
  }
});

export const Trade = mongoose.models.Trade ?? mongoose.model('Trade', tradeSchema);

// Shape sent to the browser. Works for both lean objects and documents.
// Trades saved before brokers existed show the default broker. Closed trades
// carry their realized profit (net of margin), return % and days held.
export function toApi(doc, defaultBroker = null) {
  const trade = {
    id: String(doc._id),
    symbol: doc.symbol,
    side: doc.side,
    term: doc.term,
    quantity: doc.quantity,
    entryPrice: doc.entryPrice,
    entryDate: doc.entryDate,
    exitPrice: doc.exitPrice ?? null,
    exitDate: doc.exitDate ?? null,
    margin: doc.margin ?? 0,
    pnlOverride: doc.pnlOverride ?? null,
    broker: doc.broker || defaultBroker,
    splitFrom: doc.splitFrom ? String(doc.splitFrom) : null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
  const closed = trade.exitPrice != null;
  return {
    ...trade,
    realizedPnl: closed ? realizedPnl(trade) : null,
    calculatedPnl: closed ? calculatedPnlCents(trade) / 100 : null,
    returnPct: closed ? returnPct(trade) : null,
    daysHeld: closed ? daysBetween(trade.entryDate, trade.exitDate) : null,
  };
}
