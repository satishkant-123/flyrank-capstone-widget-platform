/**
 * Centralized Error Handling Middleware
 * Guarantees that errors at the boundary return clean, structured JSON and never leak unhandled 500s.
 */

function errorHandler(err, req, res, next) {
  // 1. Handle JSON syntax errors from body parser (e.g. malformed JSON sent by client)
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      error: 'Malformed JSON payload: syntax error in request body'
    });
  }

  // 2. Handle payload too large errors
  if (err.type === 'entity.too.large' || err.status === 413) {
    return res.status(413).json({
      error: 'Payload Too Large: Request body exceeds size limit'
    });
  }

  // 3. Known application errors with explicit HTTP status codes
  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  if (status >= 500) {
    console.error(`[UnhandledServerError] ${req.method} ${req.originalUrl}:`, err);
  }

  res.status(status).json({
    error: message,
    ...(err.details ? { details: err.details } : {})
  });
}

module.exports = errorHandler;
