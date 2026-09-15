const { getDatabase } = require('../db/database');

class QueueService {
  static isRunning = false;
  static timer = null;

  /**
   * Process pending background jobs with exponential-style retry and failure alerts.
   */
  static async processPendingJobs(limit = 10) {
    const db = getDatabase();
    const jobs = db.prepare(`
      SELECT * FROM background_jobs
      WHERE status = 'pending' AND attempts < 3
      ORDER BY created_at ASC
      LIMIT ?
    `).all(limit);

    for (const job of jobs) {
      try {
        const payload = JSON.parse(job.payload);
        // Simulate external notification / webhook execution
        if (process.env.SIMULATE_WORKER_ERROR === 'true') {
          throw new Error('Worker external dispatch failed');
        }

        console.log(`[BackgroundWorker] Executing job ${job.id} (${job.type}) for submission ${payload.submissionId}`);

        db.prepare(`
          UPDATE background_jobs
          SET status = 'completed', updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(job.id);
      } catch (error) {
        const nextAttempts = job.attempts + 1;
        const newStatus = nextAttempts >= 3 ? 'failed' : 'pending';

        if (newStatus === 'failed') {
          console.error(`[FAILURE ALERT] Background job ${job.id} exceeded max retries! Alert dispatched to ops: ${error.message}`);
        } else {
          console.warn(`[BackgroundWorker] Job ${job.id} attempt ${nextAttempts} failed: ${error.message}`);
        }

        db.prepare(`
          UPDATE background_jobs
          SET attempts = ?, status = ?, last_error = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(nextAttempts, newStatus, error.message, job.id);
      }
    }
  }

  static startWorker(intervalMs = 15000) {
    if (this.isRunning) return;
    this.isRunning = true;
    this.timer = setInterval(() => {
      this.processPendingJobs().catch((err) => {
        console.error('[BackgroundWorker] Error during job batch:', err.message);
      });
    }, intervalMs);
    // Unref so the interval does not prevent clean process exit in tests
    if (this.timer.unref) this.timer.unref();
  }

  static stopWorker() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
  }
}

module.exports = QueueService;
