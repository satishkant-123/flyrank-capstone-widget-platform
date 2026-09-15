const { test, describe, before } = require('node:test');
const assert = require('node:assert');
const app = require('../src/app');
const { runSeed } = require('../src/db/seed');
const { request } = require('./testHelper');

describe('Dashboard Statistics & Aggregations', () => {
  let token;

  before(async () => {
    runSeed();
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'tenant_a@example.com', password: 'Password123!' });
    token = loginRes.body.token;
  });

  test('GET /api/dashboard/stats returns correct totals and grouped aggregations', async () => {
    const res = await request(app)
      .get('/api/dashboard/stats')
      .set('Authorization', `Bearer ${token}`);

    assert.strictEqual(res.status, 200);
    const stats = res.body;

    // Tenant A has 2 sample leads seeded
    assert.strictEqual(typeof stats.total_submissions, 'number');
    assert.ok(stats.total_submissions >= 2);

    // Per-widget array
    assert.ok(Array.isArray(stats.per_widget));
    const demoWidgetStats = stats.per_widget.find((w) => w.widget_id === 'wgt_demo_a1');
    assert.ok(demoWidgetStats);
    assert.ok(demoWidgetStats.count >= 2);

    // Counts over time
    assert.ok(Array.isArray(stats.counts_over_time));
    assert.ok(stats.counts_over_time.length > 0);

    // Geolocation breakdown
    assert.ok(Array.isArray(stats.geo_breakdown));
    assert.ok(stats.geo_breakdown.length > 0);
  });
});
