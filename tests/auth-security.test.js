const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const app = require('../src/app');
const { runSeed } = require('../src/db/seed');
const { resetRateLimits } = require('../src/middleware/rateLimit');
const { request } = require('./testHelper');

describe('Authentication Security, Password Complexity & Production Lockdown', () => {
  before(() => {
    runSeed();
    resetRateLimits();
  });

  after(() => {
    resetRateLimits();
  });

  test('Reject weak passwords during registration (less than 8 chars or missing complexity)', async () => {
    const weakPasswords = ['short', 'nouppercase123', 'NOLOWERCASE123', 'NoNumbers!'];

    for (const pwd of weakPasswords) {
      const res = await request(app)
        .post('/api/auth/signup')
        .send({
          email: `user_${Date.now()}@test.com`,
          password: pwd,
          name: 'Test User'
        });

      assert.strictEqual(res.status, 400);
      assert.match(res.body.error, /Password must be at least 8 characters/i);
    }
  });

  test('Brute force authentication attempts are rate limited (429 Too Many Requests)', async () => {
    resetRateLimits();
    const responses = [];

    // Send 12 rapid failed login attempts (limit is 10)
    for (let i = 0; i < 12; i++) {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'admin@target.com', password: `wrong_${i}` });
      responses.push(res);
    }

    const statuses = responses.map((r) => r.status);
    const has429 = statuses.includes(429);
    assert.strictEqual(has429, true, 'Auth endpoint must return 429 after exceeding max attempts');

    const rateLimited = responses.find((r) => r.status === 429);
    assert.match(rateLimited.body.error, /Maximum login\/signup attempts exceeded/i);
  });

  test('In production mode, test simulation headers are ignored and cannot disable providers', async () => {
    const originalEnv = process.env.NODE_ENV;
    const originalControls = process.env.ALLOW_TEST_CONTROLS;

    try {
      process.env.NODE_ENV = 'production';
      process.env.ALLOW_TEST_CONTROLS = 'false';

      // Send request with simulation headers that would otherwise force provider failure
      const res = await request(app)
        .post('/api/submissions')
        .set('x-test-mock-geo-a-down', 'true')
        .send({
          widget_id: 'wgt_demo_a1',
          data: { name: 'Prod User', email: 'prod@example.com' },
          _hp_website: ''
        });

      // Submission succeeds, and in production test headers are strictly ignored
      assert.strictEqual(res.status, 201);
    } finally {
      process.env.NODE_ENV = originalEnv;
      process.env.ALLOW_TEST_CONTROLS = originalControls;
    }
  });
});
