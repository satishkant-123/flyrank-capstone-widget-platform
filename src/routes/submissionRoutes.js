const express = require('express');
const { getDatabase } = require('../db/database');
const { generateId } = require('../utils/security');
const { validateSubmission, validateDataAgainstWidgetSchema } = require('../middleware/validate');
const { createRateLimiter, getClientIp } = require('../middleware/rateLimit');
const GeoService = require('../services/geoService');
const SideEffectService = require('../services/sideEffectService');

const router = express.Router();

// Public submission rate limiter
const submissionRateLimiter = createRateLimiter({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60000,
  maxPerIp: parseInt(process.env.RATE_LIMIT_MAX_PER_IP, 10) || 20,
  maxPerWidget: parseInt(process.env.RATE_LIMIT_MAX_PER_WIDGET, 10) || 50
});

router.post('/', submissionRateLimiter, validateSubmission, async (req, res, next) => {
  try {
    const { widget_id, data } = req.body;
    const idempotencyKey = req.headers['x-idempotency-key'] || null;
    const origin = req.headers.origin || null;
    const db = getDatabase();

    // 1. Verify widget existence and active status
    const widget = db.prepare(`
      SELECT id, tenant_id, title, fields, allowed_origins, is_active FROM widgets WHERE id = ?
    `).get(widget_id);

    if (!widget || !widget.is_active) {
      return res.status(404).json({
        error: 'Widget not found or has been disabled by owner'
      });
    }

    // 2. Enforce Allowed Origins
    const allowedOrigins = JSON.parse(widget.allowed_origins || '["*"]');
    if (origin && !allowedOrigins.includes('*') && !allowedOrigins.includes(origin)) {
      return res.status(403).json({
        error: `Forbidden: Origin "${origin}" is not authorized for submissions to this widget.`
      });
    }

    // Set dynamic CORS response header matching the authorized origin
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }

    // 3. Validate Submission Data against Widget Schema (required fields, types, length limits)
    const widgetFields = JSON.parse(widget.fields || '[]');
    const schemaErrors = validateDataAgainstWidgetSchema(data, widgetFields);
    if (schemaErrors.length > 0) {
      return res.status(400).json({
        error: 'Schema Validation Error: Submission payload does not match widget schema requirements.',
        details: schemaErrors
      });
    }

    // 4. Idempotency Check: if key provided and already stored, return existing record
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

    // 5. Extract visitor IP with proxy verification and User-Agent
    const rawIp = getClientIp(req);
    const userAgent = req.headers['user-agent'] || 'Unknown';

    // 6. Geolocation Enrichment via Multi-Provider Fallback Chain
    // Only permit test controls in non-production test environments
    const allowTestControls = process.env.NODE_ENV !== 'production' && (process.env.ALLOW_TEST_CONTROLS === 'true' || process.env.NODE_ENV === 'test');
    const mockAFail = allowTestControls && (req.headers['x-test-mock-geo-a-down'] === 'true' || process.env.GEO_MOCK_PROVIDER_A_FAIL === 'true');
    const mockBFail = allowTestControls && (req.headers['x-test-mock-geo-b-down'] === 'true' || process.env.GEO_MOCK_PROVIDER_B_FAIL === 'true');

    const geoResult = await GeoService.enrichIp(rawIp, { mockAFail, mockBFail });

    // 7. Store submission safely in database with race-condition handling on unique idempotency constraint
    const submissionId = generateId('sub');
    try {
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
    } catch (insertError) {
      // Handle idempotency race condition: if concurrent insert beat us, return existing record
      if (idempotencyKey && insertError.message.includes('UNIQUE constraint failed')) {
        const raceExisting = db.prepare(`
          SELECT id, created_at FROM submissions
          WHERE widget_id = ? AND idempotency_key = ?
        `).get(widget.id, idempotencyKey);

        if (raceExisting) {
          return res.status(200).json({
            success: true,
            message: 'Idempotent request: submission previously recorded',
            submission_id: raceExisting.id
          });
        }
      }
      throw insertError;
    }

    const createdSubmission = {
      id: submissionId,
      widget_id: widget.id,
      tenant_id: widget.tenant_id,
      payload: data,
      visitor_ip: rawIp,
      geo: geoResult
    };

    // 8. Safe Asynchronous Side Effects (Email confirmation / webhook)
    const forceSideEffectFail = allowTestControls && (req.headers['x-test-side-effect-fail'] === 'true' || process.env.SIDE_EFFECT_FAIL === 'true');
    SideEffectService.triggerSideEffects(createdSubmission, widget, { forceFail: forceSideEffectFail }).catch((err) => {
      console.error('[SideEffect] Uncaught side-effect error:', err.message);
    });

    // 9. Respond with 201 Created
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
