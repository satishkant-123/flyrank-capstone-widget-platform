const express = require('express');
const { getDatabase } = require('../db/database');
const { generateId } = require('../utils/security');
const { validateSubmission } = require('../middleware/validate');
const { createRateLimiter } = require('../middleware/rateLimit');
const GeoService = require('../services/geoService');
const SideEffectService = require('../services/sideEffectService');

const router = express.Router();

// Public submission rate limiter: 10 requests / 10s window per IP, burst protection per widget
const submissionRateLimiter = createRateLimiter({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60000,
  maxPerIp: parseInt(process.env.RATE_LIMIT_MAX_PER_IP, 10) || 20,
  maxPerWidget: parseInt(process.env.RATE_LIMIT_MAX_PER_WIDGET, 10) || 50
});

router.post('/', submissionRateLimiter, validateSubmission, async (req, res, next) => {
  try {
    const { widget_id, data } = req.body;
    const idempotencyKey = req.headers['x-idempotency-key'] || null;
    const db = getDatabase();

    // 1. Verify widget existence and active status
    const widget = db.prepare(`
      SELECT id, tenant_id, title, is_active FROM widgets WHERE id = ?
    `).get(widget_id);

    if (!widget || !widget.is_active) {
      return res.status(404).json({
        error: 'Widget not found or has been disabled by owner'
      });
    }

    // 2. Idempotency Check: if key provided and already stored, return existing record
    if (idempotencyKey) {
      const existing = db.prepare(`
        SELECT id, created_at FROM submissions
        WHERE widget_id = ? AND idempotency_key = ?
      `).get(widget.id, idempotencyKey);

      if (existing) {
        return res.status(200).json({
          success: true,
          message: 'Idempotent request: submission previously recorded',
          submission_id: existing.id
        });
      }
    }

    // 3. Extract visitor IP and User-Agent
    const rawIp = req.headers['x-forwarded-for']
      ? req.headers['x-forwarded-for'].split(',')[0].trim()
      : (req.socket.remoteAddress || '127.0.0.1');
    const userAgent = req.headers['user-agent'] || 'Unknown';

    // 4. Geolocation Enrichment via Multi-Provider Fallback Chain
    // Supports test override headers for deterministic probe verification
    const mockAFail = req.headers['x-test-mock-geo-a-down'] === 'true' || process.env.GEO_MOCK_PROVIDER_A_FAIL === 'true';
    const mockBFail = req.headers['x-test-mock-geo-b-down'] === 'true' || process.env.GEO_MOCK_PROVIDER_B_FAIL === 'true';

    const geoResult = await GeoService.enrichIp(rawIp, { mockAFail, mockBFail });

    // 5. Store submission safely in database
    const submissionId = generateId('sub');
    db.prepare(`
      INSERT INTO submissions (id, widget_id, tenant_id, payload, visitor_ip, geo_country, geo_city, geo_provider, user_agent, idempotency_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      submissionId,
      widget.id,
      widget.tenant_id,
      JSON.stringify(data),
      rawIp,
      geoResult.country,
      geoResult.city,
      geoResult.provider,
      userAgent,
      idempotencyKey
    );

    const createdSubmission = {
      id: submissionId,
      widget_id: widget.id,
      tenant_id: widget.tenant_id,
      payload: data,
      visitor_ip: rawIp,
      geo: geoResult
    };

    // 6. Safe Asynchronous Side Effects (Email confirmation / webhook)
    // Non-critical: failure must NEVER block 201 response!
    const forceSideEffectFail = req.headers['x-test-side-effect-fail'] === 'true' || process.env.SIDE_EFFECT_FAIL === 'true';
    SideEffectService.triggerSideEffects(createdSubmission, widget, { forceFail: forceSideEffectFail }).catch((err) => {
      console.error('[SideEffect] Uncaught side-effect error:', err.message);
    });

    // 7. Respond with 201 Created
    res.status(201).json({
      success: true,
      submission_id: submissionId,
      geo: {
        country: geoResult.country,
        city: geoResult.city,
        provider: geoResult.provider
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
