const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

let instance = null;

/**
 * Initialize or retrieve the SQLite database connection.
 * Supports in-memory database (:memory:) for isolated unit testing.
 */
function getDatabase(customPath = null) {
  if (instance && !customPath) {
    return instance;
  }

  const dbPath = customPath || process.env.DB_PATH || path.join(__dirname, '../../data/widget_platform.db');

  if (dbPath !== ':memory:') {
    const dir = path.dirname(path.resolve(dbPath));
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new DatabaseSync(dbPath);

  // Enable WAL mode and foreign key constraints for production concurrency and integrity
  if (dbPath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
  }
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');

  if (!customPath) {
    instance = db;
  }
  return db;
}

function closeDatabase() {
  if (instance) {
    try {
      instance.close();
    } catch (_) {}
    instance = null;
  }
}

module.exports = {
  getDatabase,
  closeDatabase,
};
