const { test, describe, before } = require('node:test');
const assert = require('node:assert');
const app = require('../src/app');
const { runSeed } = require('../src/db/seed');
const { request } = require('./testHelper');

describe('Widget CRUD & Configuration Validation', () => {
  let token;
  let createdWidgetId;

  before(async () => {
    runSeed();
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'tenant_a@example.com', password: 'Password123!' });
    token = loginRes.body.token;
  });

  test('Create Widget (POST /api/widgets) with valid payload and snippet generation', async () => {
    const res = await request(app)
      .post('/api/widgets')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'New SaaS Waitlist',
        type: 'signup_form',
        description: 'Subscribe for early beta access',
        button_text: 'Get Early Access',
        fields: [
          { name: 'name', type: 'text', label: 'Full Name', required: true },
          { name: 'email', type: 'email', label: 'Email', required: true }
        ],
        allowed_origins: ['http://localhost:5500']
      });

    assert.strictEqual(res.status, 201);
    assert.ok(res.body.id);
    assert.strictEqual(res.body.title, 'New SaaS Waitlist');
    assert.strictEqual(res.body.type, 'signup_form');
    assert.ok(res.body.embed_snippet.includes(res.body.id));
    createdWidgetId = res.body.id;
  });

  test('Reject widget creation with invalid type or missing title (400 Bad Request)', async () => {
    const missingTitleRes = await request(app)
      .post('/api/widgets')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: '', type: 'signup_form' });

    assert.strictEqual(missingTitleRes.status, 400);
    assert.match(missingTitleRes.body.error, /title is required/i);

    const invalidTypeRes = await request(app)
      .post('/api/widgets')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Good Title', type: 'invalid_type_xyz' });

    assert.strictEqual(invalidTypeRes.status, 400);
    assert.match(invalidTypeRes.body.error, /invalid widget type/i);
  });

  test('Read Single Widget (GET /api/widgets/:id)', async () => {
    const res = await request(app)
      .get(`/api/widgets/${createdWidgetId}`)
      .set('Authorization', `Bearer ${token}`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.id, createdWidgetId);
    assert.strictEqual(res.body.title, 'New SaaS Waitlist');
  });

  test('Update Widget (PUT /api/widgets/:id)', async () => {
    const res = await request(app)
      .put(`/api/widgets/${createdWidgetId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Updated SaaS Waitlist Title',
        button_text: 'Join Instantly'
      });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.title, 'Updated SaaS Waitlist Title');
    assert.strictEqual(res.body.button_text, 'Join Instantly');
  });

  test('Delete Widget (DELETE /api/widgets/:id)', async () => {
    const delRes = await request(app)
      .delete(`/api/widgets/${createdWidgetId}`)
      .set('Authorization', `Bearer ${token}`);

    assert.strictEqual(delRes.status, 204);

    // Subsequent read should return 404
    const getRes = await request(app)
      .get(`/api/widgets/${createdWidgetId}`)
      .set('Authorization', `Bearer ${token}`);

    assert.strictEqual(getRes.status, 404);
  });
});
