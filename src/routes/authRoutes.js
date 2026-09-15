const express = require('express');
const AuthService = require('../services/authService');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

router.post('/signup', (req, res, next) => {
  try {
    const { email, password, name } = req.body || {};
    const result = AuthService.signup({ email, password, name });
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/login', (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    const result = AuthService.login({ email, password });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

router.get('/me', authMiddleware, (req, res) => {
  res.status(200).json({ tenant: req.tenant });
});

module.exports = router;
