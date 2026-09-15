const { getDatabase } = require('../db/database');

class QueueService {
  static isRunning = false;
  static timer = null;
  static MAX_RETRIES = 3;

  /**
   * Process pending background jobs with deterministic exponential backoff.
   * Backoff formula: delay = (2 ^ attempts) seconds (e.g. 2s on attempt 1, 4s on attempt 2)
   */
  static async processPendingJobs(limit = 10, maxRetries = QueueService.MAX_RETRIES) {
    const db = getDatabase();
    const jobs = db.prepare(`
      SELECT * FROM background_jobs
      WHERE status = 'pending'
        AND attempts < ?
        AND (next_retry_at IS NULL OR next_retry_at <= CURRENT_TIMESTAMP)
      ORDER BY created_at ASC
      LIMIT ?
    `).all(maxRetries, limit);

    const processed = [];

    for (const job of jobs) {
      try {
        const payload = JSON.parse(job.payload);

        // Simulated worker failure injection for testing
        if (process.env.SIMULATE_WORKER_ERROR === 'true' || payload.simulate_error) {
          throw new Error('Simulated background worker dispatch failure');
        }

        console.log(`[BackgroundWorker] Processing job ${job.id} (${job.type}) for submission ${payload.submissionId}`);

        db.prepare(`
          UPDATE background_jobs
          SET status = 'completed', updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(job.id);

        processed.push({ id: job.id, status: 'completed' });
      } catch (error) {
        const nextAttempts = job.attempts + 1;
        const isPermanentlyFailed = nextAttempts >= maxRetries;
        const newStatus = isPermanentlyFailed ? 'failed' : 'pending';

        // Exponential backoff calculation: 2^attempts seconds
        const backoffSeconds = Math.pow(2, nextAttempts);
        const nextRetryDate = new Date(Date.now() + backoffSeconds * 1000);
        // SQLite format: YYYY-MM-DD HH:MM:SS
        const nextRetryAt = nextRetryDate.toISOString().replace('T', ' ').replace(/\..+/, '');

        if (isPermanentlyFailed) {
          console.error(`[FAILURE ALERT] Background job ${job.id} exceeded max retries (${maxRetries})! Alerting incident response: ${error.message}`);
        } else {
          console.warn(`[BackgroundWorker] Job ${job.id} attempt ${nextAttempts} failed: ${error.message}. Next retry scheduled at: ${nextRetryAt} (+${backoffSeconds}s exponential backoff)`);
        }

        db.prepare(`
          UPDATE background_jobs
          SET attempts = ?, status = ?, last_error = ?, next_retry_at = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(nextAttempts, newStatus, error.message, nextRetryAt, job.id);

        processed.push({
          id: job.id,
          status: newStatus,
          attempts: nextAttempts,
          next_retry_at: nextRetryAt,
          error: error.message
        });
      }
    }

    return processed;
  }

  static startWorker(intervalMs = 15000) {
    if (this.isRunning) return;
    this.isRunning = true;
    this.timer = setInterval(() => {
      this.processPendingJobs().catch((err) => {
        console.error('[BackgroundWorker] Error during job batch:', err.message);
      });
    }, intervalMs);
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
