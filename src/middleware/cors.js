/**
 * Robust Cross-Origin Resource Sharing (CORS) Middleware
 * Correctly answers browser preflight (OPTIONS) requests and sets permissive
 * or origin-validated headers for public widget and submission endpoints.
 */

function corsMiddleware(req, res, next) {
  const origin = req.headers.origin || '*';

  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, X-Idempotency-Key, x-test-mock-geo-a-down, x-test-mock-geo-b-down, x-test-side-effect-fail');
  res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours preflight cache

  // Handle preflight OPTIONS request immediately
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  next();
}

module.exports = corsMiddleware;
