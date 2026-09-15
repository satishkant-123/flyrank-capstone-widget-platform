require('dotenv').config();
const express = require('express');
const path = require('node:path');

const corsMiddleware = require('./middleware/cors');
const { payloadSizeLimit } = require('./middleware/validate');
const errorHandler = require('./middleware/errorHandler');

const authRoutes = require('./routes/authRoutes');
const widgetRoutes = require('./routes/widgetRoutes');
const publicRoutes = require('./routes/publicRoutes');
const submissionRoutes = require('./routes/submissionRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');

const app = express();

// Configure trusted proxy forwarding if enabled via environment
if (process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', true);
}

// 1. Global CORS middleware (handles preflight OPTIONS for all routes)
app.use(corsMiddleware);

// 2. Strict Payload Size Check at the boundary
app.use(payloadSizeLimit);

// 3. Body parsers with 100KB limit
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

// 4. Health Check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// 5. Versioned Public Delivery & Config Routes (explicit cache headers)
app.use('/', publicRoutes);

// 6. Owner Dashboard Web Route
app.get('/dashboard', (req, res) => {
  const dashboardHtml = require('node:fs').readFileSync(path.join(__dirname, '../public/dashboard.html'), 'utf8');
  res.type('html').send(dashboardHtml);
});

// 7. API Routes
app.use('/api/auth', authRoutes);
app.use('/api/widgets', widgetRoutes);
app.use('/api/submissions', submissionRoutes);
app.use('/api/dashboard', dashboardRoutes);

// 8. Serve other static public files if any
app.use(express.static(path.join(__dirname, '../public')));

// 8. 404 Fallback Handler
app.use((req, res) => {
  res.status(404).json({ error: `Not Found: ${req.method} ${req.originalUrl}` });
});

// 9. Centralized Error Handler (guarantees clean JSON, never 500 HTML leak)
app.use(errorHandler);

module.exports = app;
