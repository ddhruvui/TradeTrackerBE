import mongoose from 'mongoose';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const FIELD_LABELS = {
  symbol: 'Stock',
  side: 'Type',
  term: 'Term',
  quantity: 'Quantity',
  entryPrice: 'Price',
  entryDate: 'Date',
  exitPrice: 'Exit price',
  exitDate: 'Exit date',
  margin: 'Margin',
  broker: 'Broker',
};

function describe(err) {
  if (err instanceof mongoose.Error.CastError) {
    const label = FIELD_LABELS[err.path] ?? err.path;
    return err.kind === 'Number' ? `${label} must be a number.` : `${label} is not valid.`;
  }
  return err.message;
}

// Express error middleware: turns failures into { error, fields? } JSON.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof mongoose.Error.ValidationError) {
    const fields = Object.fromEntries(
      Object.entries(err.errors).map(([path, fieldErr]) => [path, describe(fieldErr)]),
    );
    return res.status(400).json({ error: Object.values(fields)[0], fields });
  }
  if (err instanceof mongoose.Error.CastError) {
    return res.status(400).json({ error: describe(err) });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'The request body must be valid JSON.' });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error(err);
  res.status(500).json({
    error: 'The server hit an unexpected error. Check the terminal running the API.',
  });
}
