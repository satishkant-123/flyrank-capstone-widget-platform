const { getDatabase } = require('../db/database');
const { hashPassword, verifyPassword, signJwt, generateId } = require('../utils/security');

class AuthService {
  static signup({ email, password, name }) {
    if (!email || !password || !name) {
      const err = new Error('Email, password, and name are required');
      err.status = 400;
      throw err;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      const err = new Error('Invalid email format');
      err.status = 400;
      throw err;
    }

    if (password.length < 8) {
      const err = new Error('Password must be at least 8 characters long');
      err.status = 400;
      throw err;
    }

    const db = getDatabase();
    const existing = db.prepare('SELECT id FROM tenants WHERE email = ?').get(email.toLowerCase().trim());
    if (existing) {
      const err = new Error('A tenant with this email already exists');
      err.status = 409;
      throw err;
    }

    const id = generateId('ten');
    const password_hash = hashPassword(password);
    const normalizedEmail = email.toLowerCase().trim();

    db.prepare(`
      INSERT INTO tenants (id, email, password_hash, name)
      VALUES (?, ?, ?, ?)
    `).run(id, normalizedEmail, password_hash, name.trim());

    const token = signJwt({ id, email: normalizedEmail, name: name.trim() });
    return {
      token,
      tenant: { id, email: normalizedEmail, name: name.trim() }
    };
  }

  static login({ email, password }) {
    if (!email || !password) {
      const err = new Error('Email and password are required');
      err.status = 400;
      throw err;
    }

    const db = getDatabase();
    const tenant = db.prepare('SELECT * FROM tenants WHERE email = ?').get(email.toLowerCase().trim());
    if (!tenant) {
      const err = new Error('Invalid email or password');
      err.status = 401;
      throw err;
    }

    const isValid = verifyPassword(password, tenant.password_hash);
    if (!isValid) {
      const err = new Error('Invalid email or password');
      err.status = 401;
      throw err;
    }

    const token = signJwt({ id: tenant.id, email: tenant.email, name: tenant.name });
    return {
      token,
      tenant: { id: tenant.id, email: tenant.email, name: tenant.name }
    };
  }

  static getTenantById(id) {
    const db = getDatabase();
    const tenant = db.prepare('SELECT id, email, name, created_at FROM tenants WHERE id = ?').get(id);
    return tenant || null;
  }
}

module.exports = AuthService;
