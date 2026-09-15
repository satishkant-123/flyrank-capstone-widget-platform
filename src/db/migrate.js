const { getDatabase } = require('./database');

const MIGRATION_SQL = `
-- 1. Tenants (Customers)
CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_tenants_email ON tenants(email);

-- 2. Widgets (Tenant-isolated embeddable forms)
CREATE TABLE IF NOT EXISTS widgets (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'signup_form',
    description TEXT,
    fields TEXT NOT NULL DEFAULT '[]',
    button_text TEXT NOT NULL DEFAULT 'Submit',
    display_options TEXT NOT NULL DEFAULT '{}',
    allowed_origins TEXT NOT NULL DEFAULT '["*"]',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_widgets_tenant_id ON widgets(tenant_id);

-- 3. Submissions (Public leads with geo enrichment and unique idempotency constraint)
CREATE TABLE IF NOT EXISTS submissions (
    id TEXT PRIMARY KEY,
    widget_id TEXT NOT NULL REFERENCES widgets(id) ON DELETE CASCADE,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    payload TEXT NOT NULL,
    visitor_ip TEXT,
    geo_country TEXT,
    geo_city TEXT,
    geo_provider TEXT,
    user_agent TEXT,
    idempotency_key TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_submissions_widget_id ON submissions(widget_id);
CREATE INDEX IF NOT EXISTS idx_submissions_tenant_id ON submissions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_submissions_created_at ON submissions(created_at);

-- Partial Unique Index guaranteeing idempotency per widget when key is supplied
CREATE UNIQUE INDEX IF NOT EXISTS uq_widget_idempotency ON submissions(widget_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- 4. Background Jobs (Safe side effects, outbox pattern with exponential backoff scheduling)
CREATE TABLE IF NOT EXISTS background_jobs (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    next_retry_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_jobs_status_schedule ON background_jobs(status, next_retry_at);
`;

function runMigrations(db = null) {
  const targetDb = db || getDatabase();

  // Run initial schema creation
  targetDb.exec(MIGRATION_SQL);

  // Safe additive column migrations for existing databases
  try {
    targetDb.exec('ALTER TABLE background_jobs ADD COLUMN next_retry_at DATETIME DEFAULT CURRENT_TIMESTAMP;');
  } catch (_) {
    // Column already exists
  }

  try {
    targetDb.exec('CREATE UNIQUE INDEX IF NOT EXISTS uq_widget_idempotency ON submissions(widget_id, idempotency_key) WHERE idempotency_key IS NOT NULL;');
  } catch (_) {}

  return true;
}

if (require.main === module) {
  try {
    runMigrations();
    console.log('Database migrations completed successfully.');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

module.exports = {
  runMigrations,
  MIGRATION_SQL,
};
