const { getDatabase } = require('../db/database');
const { generateId } = require('../utils/security');

class WidgetService {
  static generateEmbedSnippet(widgetId, baseUrl = process.env.BASE_URL || 'http://localhost:3000') {
    return `<script src="${baseUrl}/widget.v1.js?id=${widgetId}"></script>`;
  }

  static createWidget(tenantId, data, baseUrl) {
    const { title, type = 'signup_form', description = '', fields = [], button_text = 'Submit', display_options = {}, allowed_origins = ['*'] } = data;

    if (!title || typeof title !== 'string' || !title.trim()) {
      const err = new Error('Widget title is required');
      err.status = 400;
      throw err;
    }

    const validTypes = ['signup_form', 'cta', 'popover'];
    if (!validTypes.includes(type)) {
      const err = new Error(`Invalid widget type. Must be one of: ${validTypes.join(', ')}`);
      err.status = 400;
      throw err;
    }

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
      description.trim(),
      typeof fields === 'string' ? fields : JSON.stringify(fields),
      button_text.trim(),
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

    const title = data.title !== undefined ? data.title : existing.title;
    const type = data.type !== undefined ? data.type : existing.type;
    const description = data.description !== undefined ? data.description : existing.description;
    const fields = data.fields !== undefined ? (typeof data.fields === 'string' ? data.fields : JSON.stringify(data.fields)) : JSON.stringify(existing.fields);
    const button_text = data.button_text !== undefined ? data.button_text : existing.button_text;
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
    // Check ownership first
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
