/**
 * In-Memory Sliding Window Rate Limiter for Abuse Protection
 * Supports rate limiting per IP and per widget, with secure proxy-trust enforcement.
 */

const ipStore = new Map();
const widgetStore = new Map();
const authStore = new Map();

function getClientIp(req) {
  // Only trust X-Forwarded-For if explicitly configured via TRUST_PROXY
  if (process.env.TRUST_PROXY === 'true' && req.headers['x-forwarded-for']) {
    return req.headers['x-forwarded-for'].split(',')[0].trim();
  }
  return req.socket?.remoteAddress || '127.0.0.1';
}

function createRateLimiter(options = {}) {
  const windowMs = options.windowMs || parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60000;
  const maxPerIp = options.maxPerIp || parseInt(process.env.RATE_LIMIT_MAX_PER_IP, 10) || 10;
  const maxPerWidget = options.maxPerWidget || parseInt(process.env.RATE_LIMIT_MAX_PER_WIDGET, 10) || 30;

  return function rateLimitMiddleware(req, res, next) {
    const now = Date.now();
    const ip = getClientIp(req);
    const widgetId = req.body?.widget_id || req.params?.id || req.query?.id;

    // --- 1. IP Rate Limiting ---
    let ipRecord = ipStore.get(ip) || [];
    ipRecord = ipRecord.filter((t) => now - t < windowMs);
    ipStore.set(ip, ipRecord);

    if (ipRecord.length >= maxPerIp) {
      const oldest = ipRecord[0];
      const retryAfterSeconds = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));

      res.setHeader('Retry-After', retryAfterSeconds);
      res.setHeader('X-RateLimit-Limit', maxPerIp);
      res.setHeader('X-RateLimit-Remaining', 0);
      return res.status(429).json({
        error: 'Too Many Requests: Rate limit exceeded for this IP address.',
        retry_after_seconds: retryAfterSeconds
      });
    }

    // --- 2. Widget Rate Limiting (Burst protection per widget) ---
    if (widgetId) {
      let widgetRecord = widgetStore.get(widgetId) || [];
      widgetRecord = widgetRecord.filter((t) => now - t < windowMs);
      widgetStore.set(widgetId, widgetRecord);

      if (widgetRecord.length >= maxPerWidget) {
        const oldest = widgetRecord[0];
        const retryAfterSeconds = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));

        res.setHeader('Retry-After', retryAfterSeconds);
        res.setHeader('X-RateLimit-Limit', maxPerWidget);
        res.setHeader('X-RateLimit-Remaining', 0);
        return res.status(429).json({
          error: 'Too Many Requests: Rate limit exceeded for this widget.',
          retry_after_seconds: retryAfterSeconds
        });
      }
      widgetRecord.push(now);
    }

    ipRecord.push(now);

    res.setHeader('X-RateLimit-Limit', maxPerIp);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, maxPerIp - ipRecord.length));

    next();
  };
}

/**
 * Specialized rate limiter for Authentication endpoints to prevent credential brute-forcing
 */
function createAuthRateLimiter(options = {}) {
  const windowMs = options.windowMs || 60000;
  const maxAttempts = options.maxAttempts || parseInt(process.env.AUTH_RATE_LIMIT_MAX, 10) || 10;

  return function authRateLimitMiddleware(req, res, next) {
    const now = Date.now();
    const ip = getClientIp(req);

    let attempts = authStore.get(ip) || [];
    attempts = attempts.filter((t) => now - t < windowMs);
    authStore.set(ip, attempts);

    if (attempts.length >= maxAttempts) {
      const oldest = attempts[0];
      const retryAfterSeconds = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
      res.setHeader('Retry-After', retryAfterSeconds);
      return res.status(429).json({
        error: 'Too Many Requests: Maximum login/signup attempts exceeded. Please try again later.',
        retry_after_seconds: retryAfterSeconds
      });
    }

    attempts.push(now);
    next();
  };
}

function resetRateLimits() {
  ipStore.clear();
  widgetStore.clear();
  authStore.clear();
}

module.exports = {
  createRateLimiter,
  createAuthRateLimiter,
  resetRateLimits,
  getClientIp
};
