const { verifyJwt } = require('../utils/security');
const { getDatabase } = require('../db/database');

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Unauthorized: Missing or invalid Authorization header. Expected Bearer token.'
    });
  }

  const token = authHeader.substring(7).trim();

  try {
    const payload = verifyJwt(token);

    // Verify tenant still exists in database
    const db = getDatabase();
    const tenant = db.prepare('SELECT id, email, name FROM tenants WHERE id = ?').get(payload.id);

    if (!tenant) {
      return res.status(401).json({ error: 'Unauthorized: Tenant account no longer exists' });
    }

    req.tenant = tenant;
    next();
  } catch (error) {
    return res.status(401).json({
      error: `Unauthorized: ${error.message}`
    });
  }
}

module.exports = authMiddleware;
