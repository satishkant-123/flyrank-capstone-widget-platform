const { test, describe, before } = require('node:test');
const assert = require('node:assert');
const app = require('../src/app');
const { runSeed } = require('../src/db/seed');
const { getDatabase } = require('../src/db/database');
const { request } = require('./testHelper');

describe('Submission Idempotency & Race Condition Safety', () => {
  before(() => {
    runSeed();
  });

  test('Replaying request with same X-Idempotency-Key returns existing submission without creating duplicates', async () => {
    const key = 'idem_key_unique_12345';
    const payload = {
      widget_id: 'wgt_demo_a1',
      data: { name: 'Idempotent User', email: 'idem@test.com' },
      _hp_website: ''
    };

    // First request -> 201 Created
    const res1 = await request(app)
      .post('/api/submissions')
      .set('X-Idempotency-Key', key)
      .send(payload);

    assert.strictEqual(res1.status, 201);
    const submissionId = res1.body.submission_id;
    assert.ok(submissionId);

    // Second request with same idempotency key -> 200 OK with same ID
    const res2 = await request(app)
      .post('/api/submissions')
      .set('X-Idempotency-Key', key)
      .send(payload);

    assert.strictEqual(res2.status, 200);
    assert.strictEqual(res2.body.submission_id, submissionId);
    assert.match(res2.body.message, /Idempotent request/i);

    // Verify database has exactly 1 row with this idempotency key
    const db = getDatabase();
    const rows = db.prepare('SELECT id FROM submissions WHERE idempotency_key = ?').all(key);
    assert.strictEqual(rows.length, 1, 'Database must contain exactly 1 row due to unique constraint');
  });

  test('Database enforces UNIQUE constraint uq_widget_idempotency at SQL layer', () => {
    const db = getDatabase();
    const key = 'direct_sql_constraint_key';

    // First direct insert
    db.prepare(`
      INSERT INTO submissions (id, widget_id, tenant_id, payload, idempotency_key)
      VALUES ('sub_direct_1', 'wgt_demo_a1', 'ten_demo_a', '{}', ?)
    `).run(key);

    // Second direct insert must throw UNIQUE constraint failed
    assert.throws(
      () => {
        db.prepare(`
          INSERT INTO submissions (id, widget_id, tenant_id, payload, idempotency_key)
          VALUES ('sub_direct_2', 'wgt_demo_a1', 'ten_demo_a', '{}', ?)
        `).run(key);
      },
      /UNIQUE constraint failed/i
    );
  });
});
