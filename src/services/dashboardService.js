const { getDatabase } = require('../db/database');

class DashboardService {
  static getStats(tenantId) {
    const db = getDatabase();

    // 1. Total submissions count
    const totalRow = db.prepare(`
      SELECT COUNT(*) as total FROM submissions WHERE tenant_id = ?
    `).get(tenantId);

    // 2. Submissions per widget
    const perWidget = db.prepare(`
      SELECT w.id as widget_id, w.title, w.type, COUNT(s.id) as count
      FROM widgets w
      LEFT JOIN submissions s ON s.widget_id = w.id
      WHERE w.tenant_id = ?
      GROUP BY w.id, w.title, w.type
      ORDER BY count DESC
    `).all(tenantId);

    // 3. Submissions over time (by date)
    const overTime = db.prepare(`
      SELECT DATE(created_at) as date, COUNT(*) as count
      FROM submissions
      WHERE tenant_id = ?
      GROUP BY DATE(created_at)
      ORDER BY date ASC
      LIMIT 30
    `).all(tenantId);

    // 4. Geolocation breakdown
    const geoBreakdown = db.prepare(`
      SELECT COALESCE(geo_country, 'Unknown') as country, COUNT(*) as count
      FROM submissions
      WHERE tenant_id = ?
      GROUP BY geo_country
      ORDER BY count DESC
      LIMIT 10
    `).all(tenantId);

    return {
      total_submissions: totalRow ? totalRow.total : 0,
      per_widget: perWidget,
      counts_over_time: overTime,
      geo_breakdown: geoBreakdown
    };
  }

  static getSubmissions(tenantId, options = {}) {
    const db = getDatabase();
    const page = Math.max(1, parseInt(options.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(options.limit, 10) || 20));
    const offset = (page - 1) * limit;
    const widgetId = options.widget_id;

    let countQuery = 'SELECT COUNT(*) as total FROM submissions WHERE tenant_id = ?';
    let dataQuery = `
      SELECT s.*, w.title as widget_title
      FROM submissions s
      JOIN widgets w ON s.widget_id = w.id
      WHERE s.tenant_id = ?
    `;
    const params = [tenantId];

    if (widgetId) {
      countQuery += ' AND widget_id = ?';
      dataQuery += ' AND s.widget_id = ?';
      params.push(widgetId);
    }

    dataQuery += ' ORDER BY s.created_at DESC LIMIT ? OFFSET ?';

    const totalCount = db.prepare(countQuery).get(...params).total;
    const rows = db.prepare(dataQuery).all(...params, limit, offset);

    const items = rows.map((row) => ({
      id: row.id,
      widget_id: row.widget_id,
      widget_title: row.widget_title,
      payload: JSON.parse(row.payload || '{}'),
      visitor_ip: row.visitor_ip,
      geo_country: row.geo_country,
      geo_city: row.geo_city,
      geo_provider: row.geo_provider,
      created_at: row.created_at
    }));

    return {
      items,
      pagination: {
        page,
        limit,
        total: totalCount,
        total_pages: Math.ceil(totalCount / limit)
      }
    };
  }
}

module.exports = DashboardService;
