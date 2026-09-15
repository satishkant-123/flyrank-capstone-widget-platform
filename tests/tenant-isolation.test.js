const { test, describe, before } = require('node:test');
const assert = require('node:assert');
const app = require('../src/app');
const { runSeed } = require('../src/db/seed');
const { request } = require('./testHelper');

describe('Tenant Isolation & Authentication Guards (Multi-tenant Security)', () => {
  let tokenA;
  let tokenB;

  before(async () => {
    runSeed();

    // Login Tenant A
    const resA = await request(app)
      .post('/api/auth/login')
      .send({ email: 'tenant_a@example.com', password: 'Password123!' });
    tokenA = resA.body.token;

    // Login Tenant B
    const resB = await request(app)
      .post('/api/auth/login')
      .send({ email: 'tenant_b@example.com', password: 'Password123!' });
    tokenB = resB.body.token;
  });

  test('Unauthenticated requests to protected endpoints are rejected with 401 Unauthorized', async () => {
    const res = await request(app).get('/api/widgets');
    assert.strictEqual(res.status, 401);
    assert.match(res.body.error, /Unauthorized/i);
  });

  test('Tenant A can list their own widgets, but cannot see Tenant B widgets', async () => {
    const res = await request(app)
      .get('/api/widgets')
      .set('Authorization', `Bearer ${tokenA}`);

    assert.strictEqual(res.status, 200);
    const widgetIds = res.body.items.map((w) => w.id);

    assert.ok(widgetIds.includes('wgt_demo_a1'), 'Tenant A must see their own widget');
    assert.ok(!widgetIds.includes('wgt_demo_b1'), 'Tenant A must NEVER see Tenant B widget');
  });

  test('Tenant A cannot read Tenant B single widget (403 Forbidden)', async () => {
    const res = await request(app)
      .get('/api/widgets/wgt_demo_b1')
      .set('Authorization', `Bearer ${tokenA}`);

    assert.strictEqual(res.status, 403);
    assert.match(res.body.error, /Access denied/i);
  });

  test('Tenant A cannot update Tenant B widget (403 Forbidden)', async () => {
    const res = await request(app)
      .put('/api/widgets/wgt_demo_b1')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ title: 'Hacked by Tenant A' });

    assert.strictEqual(res.status, 403);
  });

  test('Tenant A cannot delete Tenant B widget (403 Forbidden)', async () => {
    const res = await request(app)
      .delete('/api/widgets/wgt_demo_b1')
      .set('Authorization', `Bearer ${tokenA}`);

    assert.strictEqual(res.status, 403);
  });

  test('Tenant A dashboard submissions only include leads for Tenant A widgets', async () => {
    const res = await request(app)
      .get('/api/dashboard/submissions')
      .set('Authorization', `Bearer ${tokenA}`);

    assert.strictEqual(res.status, 200);
    res.body.items.forEach((item) => {
      assert.strictEqual(item.widget_id, 'wgt_demo_a1', 'Tenant A must only see submissions for Tenant A widgets');
    });
  });
});
