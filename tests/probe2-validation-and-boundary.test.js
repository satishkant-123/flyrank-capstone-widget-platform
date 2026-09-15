const { test, describe, before } = require('node:test');
const assert = require('node:assert');
const app = require('../src/app');
const { runSeed } = require('../src/db/seed');
const { request } = require('./testHelper');

describe('PROBE 2 — Boundary Validation: Malformed & Oversized Payloads (Clean 4xx, Never 500)', () => {
  before(async () => {
    runSeed();
  });

  test('Send malformed JSON syntax -> returns HTTP 400 Bad Request JSON error (never 500)', async () => {
    const res = await request(app)
      .post('/api/submissions')
      .set('Content-Type', 'application/json')
      .send('{"widget_id": "wgt_demo_a1", "broken_json": }');

    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error);
    assert.match(res.body.error, /Malformed JSON payload/i);
  });

  test('Send oversized payload (> 100KB) -> returns HTTP 413 Payload Too Large (never 500)', async () => {
    const hugePadding = 'X'.repeat(120 * 1024); // 120KB string
    const res = await request(app)
      .post('/api/submissions')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({
        widget_id: 'wgt_demo_a1',
        data: {
          name: 'Spam Bot',
          email: 'bot@spam.com',
          padding: hugePadding
        }
      }));

    assert.strictEqual(res.status, 413);
    assert.ok(res.body.error);
    assert.match(res.body.error, /Payload Too Large/i);
  });

  test('Send invalid input with missing widget_id -> returns HTTP 400 Bad Request JSON error', async () => {
    const res = await request(app)
      .post('/api/submissions')
      .send({
        data: { name: 'Alice' }
      });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /widget_id is required/i);
  });

  test('Send invalid input with malformed email -> returns HTTP 400 Bad Request JSON error', async () => {
    const res = await request(app)
      .post('/api/submissions')
      .send({
        widget_id: 'wgt_demo_a1',
        data: { email: 'not-an-email' }
      });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /Invalid email format/i);
  });

  test('Send submission for non-existent widget -> returns HTTP 404 Not Found JSON error', async () => {
    const res = await request(app)
      .post('/api/submissions')
      .send({
        widget_id: 'wgt_non_existent_999',
        data: { email: 'valid@example.com' }
      });

    assert.strictEqual(res.status, 404);
    assert.match(res.body.error, /Widget not found/i);
  });
});
