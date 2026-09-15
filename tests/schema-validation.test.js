const { test, describe, before } = require('node:test');
const assert = require('node:assert');
const app = require('../src/app');
const { runSeed } = require('../src/db/seed');
const { request } = require('./testHelper');

describe('Widget Schema & Origin Enforcement Validation', () => {
  let token;
  let originRestrictedWidgetId;

  before(async () => {
    runSeed();
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'tenant_a@example.com', password: 'Password123!' });
    token = loginRes.body.token;

    // Create a widget with strict allowed origins
    const wgtRes = await request(app)
      .post('/api/widgets')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Restricted Domain Widget',
        type: 'signup_form',
        fields: [
          { name: 'name', type: 'text', label: 'Name', required: true },
          { name: 'email', type: 'email', label: 'Email', required: true }
        ],
        allowed_origins: ['https://trusted-domain.com']
      });
    originRestrictedWidgetId = wgtRes.body.id;
  });

  test('Missing required field defined in widget schema returns 400 with field error details', async () => {
    const res = await request(app)
      .post('/api/submissions')
      .send({
        widget_id: 'wgt_demo_a1', // requires name and email
        data: {
          name: 'Bob' // missing email!
        },
        _hp_website: ''
      });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /Schema Validation Error/i);
    assert.ok(Array.isArray(res.body.details));
    const emailErr = res.body.details.find((d) => d.field === 'email');
    assert.ok(emailErr);
    assert.match(emailErr.message, /is required/i);
  });

  test('Field exceeding 500 characters maximum length returns 400 Bad Request', async () => {
    const longString = 'A'.repeat(501);
    const res = await request(app)
      .post('/api/submissions')
      .send({
        widget_id: 'wgt_demo_a1',
        data: {
          name: longString,
          email: 'valid@example.com'
        },
        _hp_website: ''
      });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /Schema Validation Error/i);
    const lengthErr = res.body.details.find((d) => d.field === 'name');
    assert.ok(lengthErr);
    assert.match(lengthErr.message, /exceeds maximum length/i);
  });

  test('Submission from unauthorized origin is rejected with 403 Forbidden', async () => {
    const res = await request(app)
      .post('/api/submissions')
      .set('Origin', 'https://malicious-site.com')
      .send({
        widget_id: originRestrictedWidgetId,
        data: {
          name: 'Hacker',
          email: 'hacker@malicious-site.com'
        },
        _hp_website: ''
      });

    assert.strictEqual(res.status, 403);
    assert.match(res.body.error, /not authorized/i);
  });

  test('Submission from authorized origin succeeds with 201 Created and matching CORS header', async () => {
    const res = await request(app)
      .post('/api/submissions')
      .set('Origin', 'https://trusted-domain.com')
      .send({
        widget_id: originRestrictedWidgetId,
        data: {
          name: 'Trusted Partner',
          email: 'partner@trusted-domain.com'
        },
        _hp_website: ''
      });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.headers['access-control-allow-origin'], 'https://trusted-domain.com');
  });
});
