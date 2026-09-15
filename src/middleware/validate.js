/**
 * Boundary Validation Middleware
 * Enforces payload size restrictions (< 100KB), JSON syntax correctness, and honeypot/field validation.
 */

const MAX_PAYLOAD_BYTES = 100 * 1024; // 100KB limit

/**
 * Check request size at the earliest boundary before parsing large bodies into memory.
 */
function payloadSizeLimit(req, res, next) {
  const contentLength = parseInt(req.headers['content-length'], 10);

  if (contentLength && contentLength > MAX_PAYLOAD_BYTES) {
    return res.status(413).json({
      error: 'Payload Too Large: Request body exceeds maximum allowed size of 100KB.'
    });
  }

  next();
}

/**
 * Validates submission payload structure, field types, and honeypot trap.
 */
function validateSubmission(req, res, next) {
  const body = req.body;

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({
      error: 'Bad Request: Missing or invalid request body. Expected a JSON object.'
    });
  }

  // 1. Honeypot Anti-Spam Check
  // Bots auto-fill all inputs including hidden ones; humans leave them blank.
  const honeypotKeys = ['_hp_website', 'website', '_hp_email', '_gotcha'];
  for (const key of honeypotKeys) {
    if (body[key] && typeof body[key] === 'string' && body[key].trim() !== '') {
      console.warn(`[AntiSpam] Honeypot field "${key}" triggered with value: "${body[key]}"`);
      // Reject spam submission with 400 Bad Request
      return res.status(400).json({
        error: 'Bad Request: Spam submission rejected.'
      });
    }
  }

  // 2. Widget ID verification
  if (!body.widget_id || typeof body.widget_id !== 'string') {
    return res.status(400).json({
      error: 'Validation Error: widget_id is required.'
    });
  }

  // 3. Form data dictionary verification
  if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) {
    return res.status(400).json({
      error: 'Validation Error: "data" field must be an object containing form field values.'
    });
  }

  // 4. Basic email format check if email is present
  if (body.data.email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(String(body.data.email))) {
      return res.status(400).json({
        error: 'Validation Error: Invalid email format in data payload.'
      });
    }
  }

  next();
}

module.exports = {
  payloadSizeLimit,
  validateSubmission,
  MAX_PAYLOAD_BYTES
};
