const { test, describe, before } = require('node:test');
const assert = require('node:assert');
const app = require('../src/app');
const { runSeed } = require('../src/db/seed');
const { request } = require('./testHelper');

describe('PROBE 1 — Cross-Origin Submission and Owner Dashboard Visibility', () => {
  let tenantToken;

  before(async () => {
    runSeed();

    // Log in as Tenant A to retrieve JWT
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'tenant_a@example.com', password: 'Password123!' });

    assert.strictEqual(loginRes.status, 200);
    tenantToken = loginRes.body.token;
  });

  test('Public widget delivery endpoints return bundle and config with correct cache headers', async () => {
    // 1. Script bundle
    const bundleRes = await request(app).get('/widget.v1.js');
    assert.strictEqual(bundleRes.status, 200);
    assert.strictEqual(bundleRes.headers['content-type'], 'application/javascript; charset=utf-8');
    assert.strictEqual(bundleRes.headers['cache-control'], 'public, max-age=31536000, immutable');
    assert.strictEqual(bundleRes.headers['access-control-allow-origin'], '*');

    // 2. Widget config
    const configRes = await request(app).get('/api/widgets/wgt_demo_a1/config');
    assert.strictEqual(configRes.status, 200);
    assert.strictEqual(configRes.headers['cache-control'], 'public, max-age=60, stale-while-revalidate=30');
    assert.strictEqual(configRes.headers['access-control-allow-origin'], '*');

    assert.strictEqual(configRes.body.id, 'wgt_demo_a1');
    assert.strictEqual(configRes.body.title, 'Product Waitlist Form');
  });

  test('POST a valid submission from a simulated second-origin test page (:5500) -> 201 Created and visible in Dashboard API', async () => {
    // Cross-origin preflight request
    const preflightRes = await request(app)
      .options('/api/submissions')
      .set('Origin', 'http://localhost:5500')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'Content-Type');

    assert.strictEqual(preflightRes.status, 204);
    assert.strictEqual(preflightRes.headers['access-control-allow-origin'], 'http://localhost:5500');

    // Cross-origin submission
    const submitRes = await request(app)
      .post('/api/submissions')
      .set('Origin', 'http://localhost:5500')
      .send({
        widget_id: 'wgt_demo_a1',
        data: {
          name: 'Ellen Ripley',
          email: 'ripley@weyland-yutani.com',
          company: 'Nostromo'
        },
        _hp_website: ''
      });

    assert.strictEqual(submitRes.status, 201);
    assert.strictEqual(submitRes.body.success, true);
    assert.ok(submitRes.body.submission_id);

    // Verify lead is immediately visible in the Owner Dashboard API
    const dashboardRes = await request(app)
      .get('/api/dashboard/submissions?widget_id=wgt_demo_a1')
      .set('Authorization', `Bearer ${tenantToken}`);

    assert.strictEqual(dashboardRes.status, 200);
    const storedSubmission = dashboardRes.body.items.find((item) => item.id === submitRes.body.submission_id);
    assert.ok(storedSubmission, 'Submission must be found in dashboard');
    assert.strictEqual(storedSubmission.payload.email, 'ripley@weyland-yutani.com');
    assert.strictEqual(storedSubmission.payload.name, 'Ellen Ripley');
  });
});
