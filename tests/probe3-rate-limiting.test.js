const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const app = require('../src/app');
const { runSeed } = require('../src/db/seed');
const { resetRateLimits } = require('../src/middleware/rateLimit');
const { request } = require('./testHelper');

describe('PROBE 3 — Abuse Protection: Burst Rate Limiting (429) and Legitimate Traffic Recovery', () => {
  before(async () => {
    runSeed();
    resetRateLimits();
  });

  after(() => {
    resetRateLimits();
  });

  test('Fire a burst of rapid submissions -> 429 appears and legitimate traffic from another IP succeeds', async () => {
    const burstIp = '198.51.100.42';
    const responses = [];

    // Send 25 rapid submissions from the same IP (limit is 20 per minute)
    for (let i = 0; i < 25; i++) {
      const res = await request(app)
        .post('/api/submissions')
        .set('X-Forwarded-For', burstIp)
        .send({
          widget_id: 'wgt_demo_a1',
          data: { name: `Burst User ${i}`, email: `burst${i}@example.com` },
          _hp_website: ''
        });
      responses.push(res);
    }

    const statuses = responses.map((r) => r.status);
    const has429 = statuses.includes(429);
    assert.strictEqual(has429, true, 'Rate limit threshold must trigger HTTP 429');

    // Inspect the 429 response structure
    const rateLimitedRes = responses.find((r) => r.status === 429);
    assert.ok(rateLimitedRes.headers['retry-after'], 'Must include Retry-After header');
    assert.match(rateLimitedRes.body.error, /Rate limit exceeded/i);

    // Verify legitimate traffic from a different visitor IP immediately succeeds without blockage
    const legitimateIp = '203.0.113.88';
    const legitimateRes = await request(app)
      .post('/api/submissions')
      .set('X-Forwarded-For', legitimateIp)
      .send({
        widget_id: 'wgt_demo_a1',
        data: { name: 'Good Visitor', email: 'good.visitor@company.com' },
        _hp_website: ''
      });

    assert.strictEqual(legitimateRes.status, 201, 'Legitimate traffic from different IP must continue succeeding');
    assert.strictEqual(legitimateRes.body.success, true);
  });
});
