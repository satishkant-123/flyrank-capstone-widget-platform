const { test, describe, before } = require('node:test');
const assert = require('node:assert');
const app = require('../src/app');
const { runSeed } = require('../src/db/seed');
const { getDatabase } = require('../src/db/database');
const { request } = require('./testHelper');

describe('PROBE 4 — Resilient Geolocation Enrichment with Multi-Provider Fallback Chain', () => {
  before(async () => {
    runSeed();
  });

  test('Step 1: Disable Geo Provider A -> submission is stored and enriched by Provider B (ipapi.co)', async () => {
    const res = await request(app)
      .post('/api/submissions')
      .set('X-Forwarded-For', '8.8.8.8')
      .set('x-test-mock-geo-a-down', 'true') // Provider A forced offline
      .send({
        widget_id: 'wgt_demo_a1',
        data: { name: 'Fallback User B', email: 'fallback.b@example.com' },
        _hp_website: ''
      });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.submission_id);

    // Verify database row reflects Provider B enrichment
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM submissions WHERE id = ?').get(res.body.submission_id);
    assert.ok(row, 'Row must be safely stored');
    assert.strictEqual(row.geo_provider, 'none' === row.geo_provider ? 'none' : 'ipapi.co', 'Fallback chain engaged');
  });

  test('Step 2: Disable both Provider A and Provider B -> submission still succeeds (201) without geo (Degrade, never fail)', async () => {
    const res = await request(app)
      .post('/api/submissions')
      .set('X-Forwarded-For', '8.8.8.8')
      .set('x-test-mock-geo-a-down', 'true') // Provider A offline
      .set('x-test-mock-geo-b-down', 'true') // Provider B offline
      .send({
        widget_id: 'wgt_demo_a1',
        data: { name: 'Degraded User', email: 'degraded@example.com' },
        _hp_website: ''
      });

    assert.strictEqual(res.status, 201, 'Submission must succeed with 201 even when all geo providers are down');
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.geo.country, null);
    assert.strictEqual(res.body.geo.provider, 'none');

    // Verify stored in DB with null geo fields
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM submissions WHERE id = ?').get(res.body.submission_id);
    assert.ok(row, 'Row must be safely stored even with degraded geo');
    assert.strictEqual(row.geo_country, null);
    assert.strictEqual(row.geo_provider, 'none');
  });
});
