const { test, describe, before } = require('node:test');
const assert = require('node:assert');
const app = require('../src/app');
const { runSeed } = require('../src/db/seed');
const { getDatabase } = require('../src/db/database');
const { request } = require('./testHelper');

describe('PROBE 6 — Honeypot Bot Defense: Spam Submissions Blocked / Rejected', () => {
  before(async () => {
    runSeed();
  });

  test('Bot fills the invisible honeypot field -> submission is immediately blocked and rejected (400 Bad Request)', async () => {
    const db = getDatabase();
    const countBefore = db.prepare('SELECT COUNT(*) as total FROM submissions').get().total;

    const botSpamEmail = 'spammer-bot@darkweb.ru';
    const res = await request(app)
      .post('/api/submissions')
      .send({
        widget_id: 'wgt_demo_a1',
        data: {
          name: 'SEO Spam Bot',
          email: botSpamEmail
        },
        _hp_website: 'http://buy-cheap-pills-online.biz' // Honeypot filled by bot
      });

    assert.strictEqual(res.status, 400, 'Spam submissions must be blocked at the boundary with 400 Bad Request');
    assert.match(res.body.error, /Spam submission rejected/i);

    // Verify no row was stored in the database
    const countAfter = db.prepare('SELECT COUNT(*) as total FROM submissions').get().total;
    assert.strictEqual(countAfter, countBefore, 'Spam submission must NOT be inserted into submissions table');

    const checkSpam = db.prepare("SELECT * FROM submissions WHERE payload LIKE ?").get(`%${botSpamEmail}%`);
    assert.strictEqual(checkSpam, undefined, 'No spam record should exist');
  });
});
