const { getDatabase } = require('../db/database');
const { generateId } = require('../utils/security');

class SideEffectService {
  /**
   * Safely execute secondary operations (email notification, webhook, outbox queuing).
   * GUARANTEE: This method will NEVER throw an exception or interrupt the main request flow.
   */
  static async triggerSideEffects(submission, widget, options = {}) {
    try {
      const forceFail = options.forceFail ?? (process.env.SIDE_EFFECT_FAIL === 'true');
      if (forceFail) {
        throw new Error('Simulated side-effect failure (Probe 5)');
      }

      // 1. Log notification to console (acts as $0 local mail catcher)
      const leadEmail = submission.payload?.email || 'visitor';
      console.log(`[SafeSideEffect] Confirmation email queued for ${leadEmail} (Submission: ${submission.id})`);

      // 2. Queue into resilient background_jobs table for asynchronous delivery
      const db = getDatabase();
      const jobId = generateId('job');
      const jobPayload = JSON.stringify({
        submissionId: submission.id,
        widgetId: widget.id,
        recipient: leadEmail,
        timestamp: new Date().toISOString()
      });

      db.prepare(`
        INSERT INTO background_jobs (id, type, payload, status)
        VALUES (?, ?, ?, 'pending')
      `).run(jobId, 'lead_notification', jobPayload);

      return { success: true, jobId };
    } catch (err) {
      // Degrade gracefully — non-critical operations never break the main submission path
      console.error(`[SafeSideEffect] Warning: Side-effect failed gracefully without interrupting submission: ${err.message}`);
      return { success: false, error: err.message };
    }
  }
}

module.exports = SideEffectService;
