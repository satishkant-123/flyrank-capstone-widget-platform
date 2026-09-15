const { test, describe, before } = require('node:test');
const assert = require('node:assert');
const { getDatabase } = require('../src/db/database');
const { runSeed } = require('../src/db/seed');
const QueueService = require('../src/services/queueService');

describe('Background Worker Architecture & Exponential Backoff Resilience', () => {
  before(() => {
    runSeed();
  });

  test('Background worker successfully picks up and processes pending jobs', async () => {
    const db = getDatabase();

    // Insert a pending job
    db.prepare(`
      INSERT INTO background_jobs (id, type, payload, status, attempts)
      VALUES ('job_test_1', 'lead_notification', '{"submissionId":"sub_demo_1"}', 'pending', 0)
    `).run();

    const processed = await QueueService.processPendingJobs(5);
    const jobResult = processed.find((j) => j.id === 'job_test_1');

    assert.ok(jobResult, 'Job must be processed');
    assert.strictEqual(jobResult.status, 'completed');

    const updatedRow = db.prepare('SELECT * FROM background_jobs WHERE id = ?').get('job_test_1');
    assert.strictEqual(updatedRow.status, 'completed');
  });

  test('Worker failure schedules exponential backoff and increments attempt count', async () => {
    const db = getDatabase();

    // Insert a job that triggers simulated worker error
    db.prepare(`
      INSERT INTO background_jobs (id, type, payload, status, attempts)
      VALUES ('job_fail_1', 'lead_notification', '{"submissionId":"sub_demo_1","simulate_error":true}', 'pending', 0)
    `).run();

    const processed = await QueueService.processPendingJobs(5);
    const jobResult = processed.find((j) => j.id === 'job_fail_1');

    assert.ok(jobResult);
    assert.strictEqual(jobResult.status, 'pending');
    assert.strictEqual(jobResult.attempts, 1);
    assert.ok(jobResult.next_retry_at, 'Must schedule next retry timestamp via exponential backoff');

    const row = db.prepare('SELECT * FROM background_jobs WHERE id = ?').get('job_fail_1');
    assert.strictEqual(row.attempts, 1);
    assert.strictEqual(row.status, 'pending');
    assert.ok(row.last_error.includes('Simulated background worker'));
  });

  test('Job permanently fails with alert after reaching maximum retries (attempts >= 3)', async () => {
    const db = getDatabase();

    // Insert a job on its 2nd failed attempt (next attempt will be 3 = max retries)
    db.prepare(`
      INSERT INTO background_jobs (id, type, payload, status, attempts, next_retry_at)
      VALUES ('job_max_retry', 'lead_notification', '{"submissionId":"sub_demo_1","simulate_error":true}', 'pending', 2, CURRENT_TIMESTAMP)
    `).run();

    const processed = await QueueService.processPendingJobs(5);
    const jobResult = processed.find((j) => j.id === 'job_max_retry');

    assert.ok(jobResult);
    assert.strictEqual(jobResult.status, 'failed');
    assert.strictEqual(jobResult.attempts, 3);

    const row = db.prepare('SELECT * FROM background_jobs WHERE id = ?').get('job_max_retry');
    assert.strictEqual(row.status, 'failed');
  });
});
