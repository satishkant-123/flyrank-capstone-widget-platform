const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const WidgetService = require('../services/widgetService');

const router = express.Router();
const WIDGET_BUNDLE_PATH = path.join(__dirname, '../../public/widget.v1.js');

// 1. Versioned Widget Bundle Delivery (Long-lived cache, immutable)
router.get('/widget.v1.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (fs.existsSync(WIDGET_BUNDLE_PATH)) {
    const bundle = fs.readFileSync(WIDGET_BUNDLE_PATH, 'utf8');
    res.status(200).send(bundle);
  } else {
    res.status(404).send('// Widget bundle not found');
  }
});

// Alias /widget.js (standard entry point, cache for 1 hour or redirect)
router.get('/widget.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (fs.existsSync(WIDGET_BUNDLE_PATH)) {
    const bundle = fs.readFileSync(WIDGET_BUNDLE_PATH, 'utf8');
    res.status(200).send(bundle);
  } else {
    res.status(404).send('// Widget bundle not found');
  }
});

// 2. Public Widget Config Endpoint (Short-lived cache for fast updates)
router.get('/api/widgets/:id/config', (req, res, next) => {
  try {
    const config = WidgetService.getPublicWidgetConfig(req.params.id);

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=30');
    res.setHeader('Access-Control-Allow-Origin', '*');

    res.status(200).json(config);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
