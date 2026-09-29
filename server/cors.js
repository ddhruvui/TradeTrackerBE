// Lets the dashboard call the API from its own domain (for example a Render static site).
// CORS_ORIGINS lists the sites allowed to, separated by commas:
//   CORS_ORIGINS=https://trade-tracker-fe.onrender.com
// "*" allows any site. Unset means browsers only allow same-origin calls.
export function allowedOrigins(env = process.env) {
  return String(env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

export function cors(origins) {
  const anyOrigin = origins.includes('*');
  return (req, res, next) => {
    if (origins.length && !anyOrigin) res.vary('Origin');
    const origin = req.headers.origin;
    if (!origin || !(anyOrigin || origins.includes(origin))) return next();

    res.setHeader('Access-Control-Allow-Origin', anyOrigin ? '*' : origin);
    if (req.method !== 'OPTIONS') return next();

    // Preflight: the browser asks first before sending JSON or using PATCH and DELETE.
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '600');
    res.status(204).end();
  };
}
