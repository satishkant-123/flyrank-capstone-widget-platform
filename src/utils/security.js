const crypto = require('node:crypto');

/**
 * Validate and retrieve the JWT Secret from environment.
 * Strict Security Guarantee: NEVER allows fallback secrets.
 * Must be at least 32 characters long to ensure cryptographic resilience against brute-force attacks.
 */
function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || typeof secret !== 'string') {
    throw new Error('FATAL SECURITY ERROR: JWT_SECRET environment variable is missing. A cryptographically strong secret is required.');
  }
  if (secret.length < 32) {
    throw new Error('FATAL SECURITY ERROR: JWT_SECRET is too weak. It must be at least 32 characters long.');
  }
  return secret;
}

/**
 * Hash a password using scrypt with a unique random salt
 */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `${salt}:${derivedKey.toString('hex')}`;
}

/**
 * Verify a password against a stored salt:hash string
 */
function verifyPassword(password, storedHash) {
  if (!password || !storedHash) return false;
  const [salt, keyHex] = storedHash.split(':');
  if (!salt || !keyHex) return false;

  const keyBuffer = Buffer.from(keyHex, 'hex');
  const derivedKey = crypto.scryptSync(password, salt, 64);

  return crypto.timingSafeEqual(keyBuffer, derivedKey);
}

/**
 * Validates password complexity: min 8 characters, at least 1 uppercase, 1 lowercase, 1 number
 */
function isStrongPassword(password) {
  if (!password || typeof password !== 'string') return false;
  if (password.length < 8) return false;
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  return hasUpper && hasLower && hasNumber;
}

/**
 * Base64Url encoding helper
 */
function base64UrlEncode(obj) {
  const str = typeof obj === 'string' ? obj : JSON.stringify(obj);
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/**
 * Base64Url decoding helper
 */
function base64UrlDecode(str) {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf8');
}

/**
 * Generate a signed JWT using HMAC-SHA256
 */
function signJwt(payload, secret = null, expiresInSeconds = 86400) {
  const effectiveSecret = secret || getJwtSecret();
  const header = { alg: 'HS256', typ: 'JWT' };
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const fullPayload = { ...payload, exp, iat: Math.floor(Date.now() / 1000) };

  const encodedHeader = base64UrlEncode(header);
  const encodedPayload = base64UrlEncode(fullPayload);
  const dataToSign = `${encodedHeader}.${encodedPayload}`;

  const signature = crypto
    .createHmac('sha256', effectiveSecret)
    .update(dataToSign)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${dataToSign}.${signature}`;
}

/**
 * Verify and decode a signed JWT
 */
function verifyJwt(token, secret = null) {
  const effectiveSecret = secret || getJwtSecret();
  if (!token || typeof token !== 'string') {
    throw new Error('Missing or invalid token format');
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed JWT structure');
  }

  const [encodedHeader, encodedPayload, signature] = parts;
  const dataToSign = `${encodedHeader}.${encodedPayload}`;

  const expectedSignature = crypto
    .createHmac('sha256', effectiveSecret)
    .update(dataToSign)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
    throw new Error('Invalid token signature');
  }

  const payload = JSON.parse(base64UrlDecode(encodedPayload));
  const currentTimestamp = Math.floor(Date.now() / 1000);

  if (payload.exp && payload.exp < currentTimestamp) {
    throw new Error('Token has expired');
  }

  return payload;
}

/**
 * Generate a UUID v4
 */
function generateId(prefix = '') {
  const uuid = crypto.randomUUID();
  return prefix ? `${prefix}_${uuid}` : uuid;
}

module.exports = {
  getJwtSecret,
  hashPassword,
  verifyPassword,
  isStrongPassword,
  signJwt,
  verifyJwt,
  generateId,
};
