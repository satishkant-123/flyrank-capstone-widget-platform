const { test, describe, before } = require('node:test');
const assert = require('node:assert');
const app = require('../src/app');
const { runSeed } = require('../src/db/seed');
const { getDatabase } = require('../src/db/database');
const { request } = require('./testHelper');

describe('PROBE 5 — Safe Asynchronous Side Effects (Non-critical failure never breaks 201 response)', () => {
  before(async () => {
    runSeed();
  });

  test('Force email / webhook side effect to throw -> submission still returns 201 Created and is safely stored in database', async () => {
    const res = await request(app)
      .post('/api/submissions')
      .set('x-test-side-effect-fail', 'true') // Simulates crashed notification / webhook service
      .send({
        widget_id: 'wgt_demo_a1',
        data: {
          name: 'Resilience Test Lead',
          email: 'resilience@leadtest.org',
          company: 'Anti-Fragile Systems'
        },
        _hp_website: ''
      });

    // The HTTP response MUST succeed with 201
    assert.strictEqual(res.status, 201, 'HTTP status must be 201 Created even if side-effect throws');
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.submission_id);

    // Verify lead was safely committed to the database
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM submissions WHERE id = ?').get(res.body.submission_id);
    assert.ok(row, 'Row must be safely stored in the database');
    const payload = JSON.parse(row.payload);
    assert.strictEqual(payload.email, 'resilience@leadtest.org');
    assert.strictEqual(payload.name, 'Resilience Test Lead');
  });
});
