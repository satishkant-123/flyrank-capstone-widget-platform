const { getDatabase } = require('../db/database');
const { generateId } = require('../utils/security');

const ALLOWED_WIDGET_TYPES = ['signup_form', 'cta', 'popover'];
const ALLOWED_FIELD_TYPES = ['text', 'email', 'number', 'tel', 'textarea', 'url'];

class WidgetService {
  static generateEmbedSnippet(widgetId, baseUrl = process.env.BASE_URL || 'http://localhost:3000') {
    return `<script src="${baseUrl}/widget.v1.js?id=${widgetId}"></script>`;
  }

  static validateWidgetData(data, isUpdate = false) {
    const { title, type, fields, allowed_origins, display_options } = data;

    if (!isUpdate || title !== undefined) {
      if (!title || typeof title !== 'string' || !title.trim()) {
        const err = new Error('Widget title is required and must be non-empty.');
        err.status = 400;
        throw err;
      }
      if (title.trim().length > 120) {
        const err = new Error('Widget title cannot exceed 120 characters.');
        err.status = 400;
        throw err;
      }
    }

    if (type !== undefined) {
      if (!ALLOWED_WIDGET_TYPES.includes(type)) {
        const err = new Error(`Invalid widget type "${type}". Allowed types: ${ALLOWED_WIDGET_TYPES.join(', ')}`);
        err.status = 400;
        throw err;
      }
    }

    if (fields !== undefined) {
      let parsedFields = fields;
      if (typeof fields === 'string') {
        try {
          parsedFields = JSON.parse(fields);
        } catch (_) {
          const err = new Error('Widget fields must be a valid JSON array.');
          err.status = 400;
          throw err;
        }
      }
      if (!Array.isArray(parsedFields)) {
        const err = new Error('Widget fields must be an array of field definitions.');
        err.status = 400;
        throw err;
      }

      for (const field of parsedFields) {
        if (!field || typeof field !== 'object') {
          const err = new Error('Each field definition must be an object.');
          err.status = 400;
          throw err;
        }
        if (!field.name || typeof field.name !== 'string' || !/^[a-zA-Z0-9_]{1,50}$/.test(field.name)) {
          const err = new Error(`Invalid field name "${field.name}". Must be alphanumeric or underscore (1-50 chars).`);
          err.status = 400;
          throw err;
        }
        if (field.type && !ALLOWED_FIELD_TYPES.includes(field.type)) {
          const err = new Error(`Invalid field type "${field.type}" for field "${field.name}". Allowed types: ${ALLOWED_FIELD_TYPES.join(', ')}`);
          err.status = 400;
          throw err;
        }
      }
    }

    if (allowed_origins !== undefined) {
      let parsedOrigins = allowed_origins;
      if (typeof allowed_origins === 'string') {
        try {
          parsedOrigins = JSON.parse(allowed_origins);
        } catch (_) {
          const err = new Error('allowed_origins must be a valid JSON array.');
          err.status = 400;
          throw err;
        }
      }
      if (!Array.isArray(parsedOrigins)) {
        const err = new Error('allowed_origins must be an array of origin strings (e.g. ["https://mybrand.com"] or ["*"]).');
        err.status = 400;
        throw err;
      }
      for (const origin of parsedOrigins) {
        if (typeof origin !== 'string' || !origin.trim()) {
          const err = new Error('Each allowed origin must be a non-empty string.');
          err.status = 400;
          throw err;
        }
      }
    }

    if (display_options !== undefined && typeof display_options !== 'object' && typeof display_options !== 'string') {
      const err = new Error('display_options must be an object.');
      err.status = 400;
      throw err;
    }
  }

  static createWidget(tenantId, data, baseUrl) {
    this.validateWidgetData(data, false);

    const {
      title,
      type = 'signup_form',
      description = '',
      fields = [],
      button_text = 'Submit',
      display_options = {},
      allowed_origins = ['*']
    } = data;

    const id = generateId('wgt');
    const db = getDatabase();

    db.prepare(`
      INSERT INTO widgets (id, tenant_id, title, type, description, fields, button_text, display_options, allowed_origins)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      tenantId,
      title.trim(),
      type,
      (description || '').trim(),
      typeof fields === 'string' ? fields : JSON.stringify(fields),
      (button_text || 'Submit').trim(),
      typeof display_options === 'string' ? display_options : JSON.stringify(display_options),
      typeof allowed_origins === 'string' ? allowed_origins : JSON.stringify(allowed_origins)
    );

    return this.getWidgetById(id, tenantId, baseUrl);
  }

  static getWidgetsByTenant(tenantId, baseUrl) {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM widgets WHERE tenant_id = ? ORDER BY created_at DESC
    `).all(tenantId);

    return rows.map((row) => this.formatWidget(row, baseUrl));
  }

  static getWidgetById(id, tenantId, baseUrl) {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM widgets WHERE id = ?').get(id);

    if (!row) {
      const err = new Error('Widget not found');
      err.status = 404;
      throw err;
    }

    // Strict multi-tenant isolation check
    if (tenantId && row.tenant_id !== tenantId) {
      const err = new Error('Access denied: Widget belongs to another tenant');
      err.status = 403;
      throw err;
    }

    return this.formatWidget(row, baseUrl);
  }

  static getPublicWidgetConfig(id) {
    const db = getDatabase();
    const row = db.prepare(`
      SELECT id, title, type, description, fields, button_text, display_options, allowed_origins, is_active
      FROM widgets WHERE id = ?
    `).get(id);

    if (!row || !row.is_active) {
      const err = new Error('Widget not found or inactive');
      err.status = 404;
      throw err;
    }

    return {
      id: row.id,
      title: row.title,
      type: row.type,
      description: row.description,
      fields: JSON.parse(row.fields || '[]'),
      button_text: row.button_text,
      display_options: JSON.parse(row.display_options || '{}'),
      allowed_origins: JSON.parse(row.allowed_origins || '["*"]')
    };
  }

  static updateWidget(id, tenantId, data, baseUrl) {
    const existing = this.getWidgetById(id, tenantId, baseUrl);
    this.validateWidgetData(data, true);

    const title = data.title !== undefined ? data.title.trim() : existing.title;
    const type = data.type !== undefined ? data.type : existing.type;
    const description = data.description !== undefined ? data.description.trim() : existing.description;
    const fields = data.fields !== undefined ? (typeof data.fields === 'string' ? data.fields : JSON.stringify(data.fields)) : JSON.stringify(existing.fields);
    const button_text = data.button_text !== undefined ? data.button_text.trim() : existing.button_text;
    const display_options = data.display_options !== undefined ? (typeof data.display_options === 'string' ? data.display_options : JSON.stringify(data.display_options)) : JSON.stringify(existing.display_options);
    const allowed_origins = data.allowed_origins !== undefined ? (typeof data.allowed_origins === 'string' ? data.allowed_origins : JSON.stringify(data.allowed_origins)) : JSON.stringify(existing.allowed_origins);
    const is_active = data.is_active !== undefined ? (data.is_active ? 1 : 0) : (existing.is_active ? 1 : 0);

    const db = getDatabase();
    db.prepare(`
      UPDATE widgets
      SET title = ?, type = ?, description = ?, fields = ?, button_text = ?, display_options = ?, allowed_origins = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND tenant_id = ?
    `).run(title, type, description, fields, button_text, display_options, allowed_origins, is_active, id, tenantId);

    return this.getWidgetById(id, tenantId, baseUrl);
  }

  static deleteWidget(id, tenantId) {
    this.getWidgetById(id, tenantId);
    const db = getDatabase();
    db.prepare('DELETE FROM widgets WHERE id = ? AND tenant_id = ?').run(id, tenantId);
    return true;
  }

  static formatWidget(row, baseUrl) {
    return {
      id: row.id,
      tenant_id: row.tenant_id,
      title: row.title,
      type: row.type,
      description: row.description,
      fields: JSON.parse(row.fields || '[]'),
      button_text: row.button_text,
      display_options: JSON.parse(row.display_options || '{}'),
      allowed_origins: JSON.parse(row.allowed_origins || '["*"]'),
      is_active: Boolean(row.is_active),
      embed_snippet: this.generateEmbedSnippet(row.id, baseUrl),
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }
}

module.exports = WidgetService;
