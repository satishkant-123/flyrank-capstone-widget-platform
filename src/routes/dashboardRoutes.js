const express = require('express');
const DashboardService = require('../services/dashboardService');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// All dashboard endpoints require tenant authentication
router.use(authMiddleware);

router.get('/stats', (req, res, next) => {
  try {
    const stats = DashboardService.getStats(req.tenant.id);
    res.status(200).json(stats);
  } catch (error) {
    next(error);
  }
});

router.get('/submissions', (req, res, next) => {
  try {
    const { page, limit, widget_id } = req.query;
    const submissions = DashboardService.getSubmissions(req.tenant.id, {
      page,
      limit,
      widget_id
    });
    res.status(200).json(submissions);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
