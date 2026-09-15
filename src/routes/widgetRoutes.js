const express = require('express');
const WidgetService = require('../services/widgetService');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// Helper to determine base URL
function getBaseUrl(req) {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.get('host');
  return `${protocol}://${host}`;
}

// All routes in widgetRoutes are authenticated and strictly tenant-isolated
router.use(authMiddleware);

router.post('/', (req, res, next) => {
  try {
    const baseUrl = getBaseUrl(req);
    const widget = WidgetService.createWidget(req.tenant.id, req.body, baseUrl);
    res.status(201).json(widget);
  } catch (error) {
    next(error);
  }
});

router.get('/', (req, res, next) => {
  try {
    const baseUrl = getBaseUrl(req);
    const widgets = WidgetService.getWidgetsByTenant(req.tenant.id, baseUrl);
    res.status(200).json({ items: widgets });
  } catch (error) {
    next(error);
  }
});

router.get('/:id', (req, res, next) => {
  try {
    const baseUrl = getBaseUrl(req);
    const widget = WidgetService.getWidgetById(req.params.id, req.tenant.id, baseUrl);
    res.status(200).json(widget);
  } catch (error) {
    next(error);
  }
});

router.put('/:id', (req, res, next) => {
  try {
    const baseUrl = getBaseUrl(req);
    const updated = WidgetService.updateWidget(req.params.id, req.tenant.id, req.body, baseUrl);
    res.status(200).json(updated);
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', (req, res, next) => {
  try {
    WidgetService.deleteWidget(req.params.id, req.tenant.id);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

module.exports = router;
