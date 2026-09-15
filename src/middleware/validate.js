/**
 * Boundary Validation Middleware
 * Enforces payload size restrictions (< 100KB), JSON structure correctness,
 * invisible honeypot spam protection, and widget field schema validation.
 */

const MAX_PAYLOAD_BYTES = 100 * 1024; // 100KB limit
const MAX_FIELD_STRING_LENGTH = 500; // Max characters per individual field

/**
 * Check request size at the earliest HTTP boundary before buffering large bodies into memory.
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
 * Validates initial submission body structure and honeypot field.
 */
function validateSubmission(req, res, next) {
  const body = req.body;

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({
      error: 'Bad Request: Missing or invalid request body. Expected a JSON object.'
    });
  }

  // 1. Honeypot Anti-Spam Check
  const honeypotKeys = ['_hp_website', 'website', '_hp_email', '_gotcha'];
  for (const key of honeypotKeys) {
    if (body[key] && typeof body[key] === 'string' && body[key].trim() !== '') {
      console.warn(`[AntiSpam] Honeypot field "${key}" triggered with value: "${body[key]}"`);
      return res.status(400).json({
        error: 'Bad Request: Spam submission rejected.'
      });
    }
  }

  // 2. Widget ID verification
  if (!body.widget_id || typeof body.widget_id !== 'string' || !body.widget_id.trim()) {
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

  next();
}

/**
 * Validates submission data against the specific widget's configured schema (required, types, lengths)
 */
function validateDataAgainstWidgetSchema(data, widgetFields) {
  const errors = [];
  const fields = Array.isArray(widgetFields) ? widgetFields : [];

  for (const field of fields) {
    const value = data[field.name];
    const isPresent = value !== undefined && value !== null && String(value).trim() !== '';

    // 1. Required field check
    if (field.required && !isPresent) {
      errors.push({
        field: field.name,
        message: `${field.label || field.name} is required.`
      });
      continue;
    }

    if (!isPresent) continue;

    const strValue = String(value);

    // 2. Field length limit check
    if (strValue.length > MAX_FIELD_STRING_LENGTH) {
      errors.push({
        field: field.name,
        message: `${field.label || field.name} exceeds maximum length of ${MAX_FIELD_STRING_LENGTH} characters.`
      });
      continue;
    }

    // 3. Type-specific validations
    if (field.type === 'email') {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(strValue.trim())) {
        errors.push({
          field: field.name,
          message: `${field.label || field.name} must be a valid email address.`
        });
      }
    } else if (field.type === 'number') {
      if (isNaN(Number(strValue))) {
        errors.push({
          field: field.name,
          message: `${field.label || field.name} must be a valid numeric value.`
        });
      }
    } else if (field.type === 'url') {
      try {
        new URL(strValue);
      } catch (_) {
        errors.push({
          field: field.name,
          message: `${field.label || field.name} must be a valid URL.`
        });
      }
    }
  }

  return errors;
}

module.exports = {
  payloadSizeLimit,
  validateSubmission,
  validateDataAgainstWidgetSchema,
  MAX_PAYLOAD_BYTES,
  MAX_FIELD_STRING_LENGTH
};
