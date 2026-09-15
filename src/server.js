const app = require('./app');
const { runMigrations } = require('./db/migrate');
const QueueService = require('./services/queueService');

const PORT = parseInt(process.env.PORT, 10) || 3000;

// Ensure database schema is initialized
try {
  runMigrations();
} catch (err) {
  console.error('Fatal: Failed to initialize database schema:', err);
  process.exit(1);
}

// Start resilient background job worker
QueueService.startWorker(10000);

const server = app.listen(PORT, () => {
  console.log(`FlyRank Embeddable Widget & Lead-Capture API running on http://localhost:${PORT}`);
  console.log(`Owner Dashboard: http://localhost:${PORT}/dashboard`);
  console.log(`Public Embed Script: http://localhost:${PORT}/widget.v1.js`);
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  QueueService.stopWorker();
  server.close(() => {
    process.exit(0);
  });
});

module.exports = server;
