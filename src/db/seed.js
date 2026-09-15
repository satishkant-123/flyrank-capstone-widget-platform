const { getDatabase } = require('./database');
const { runMigrations } = require('./migrate');
const { hashPassword } = require('../utils/security');

function runSeed(db = null) {
  const targetDb = db || getDatabase();
  runMigrations(targetDb);

  // Clear existing data for clean seed
  targetDb.exec(`
    DELETE FROM submissions;
    DELETE FROM widgets;
    DELETE FROM tenants;
    DELETE FROM background_jobs;
  `);

  const passwordHash = hashPassword('Password123!');

  // 1. Seed Tenants (A and B for isolation checks)
  const insertTenant = targetDb.prepare(`
    INSERT INTO tenants (id, email, password_hash, name)
    VALUES (?, ?, ?, ?)
  `);

  insertTenant.run('ten_demo_a', 'tenant_a@example.com', passwordHash, 'Alice Corp');
  insertTenant.run('ten_demo_b', 'tenant_b@example.com', passwordHash, 'Bob Systems');

  // 2. Seed Widgets
  const insertWidget = targetDb.prepare(`
    INSERT INTO widgets (id, tenant_id, title, type, description, fields, button_text, display_options, allowed_origins)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const fieldsA = JSON.stringify([
    { name: 'name', type: 'text', label: 'Full Name', required: true, placeholder: 'Jane Doe' },
    { name: 'email', type: 'email', label: 'Work Email', required: true, placeholder: 'jane@company.com' },
    { name: 'company', type: 'text', label: 'Company Name', required: false, placeholder: 'Acme Inc' }
  ]);

  insertWidget.run(
    'wgt_demo_a1',
    'ten_demo_a',
    'Product Waitlist Form',
    'signup_form',
    'Join our private beta waiting list.',
    fieldsA,
    'Join Priority Waitlist',
    JSON.stringify({ theme: 'dark', position: 'inline', primary_color: '#4F46E5' }),
    JSON.stringify(['*'])
  );

  const fieldsB = JSON.stringify([
    { name: 'name', type: 'text', label: 'Full Name', required: true, placeholder: 'John Doe' },
    { name: 'email', type: 'email', label: 'Email Address', required: true, placeholder: 'john@example.com' },
    { name: 'message', type: 'text', label: 'Your Inquiry', required: true, placeholder: 'How can we help?' }
  ]);

  insertWidget.run(
    'wgt_demo_b1',
    'ten_demo_b',
    'Tenant B Contact Widget',
    'cta',
    'Contact Bob Systems directly.',
    fieldsB,
    'Send Message',
    JSON.stringify({ theme: 'light', position: 'inline', primary_color: '#10B981' }),
    JSON.stringify(['*'])
  );

  // 3. Seed Sample Submissions
  const insertSub = targetDb.prepare(`
    INSERT INTO submissions (id, widget_id, tenant_id, payload, visitor_ip, geo_country, geo_city, geo_provider, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertSub.run(
    'sub_demo_1',
    'wgt_demo_a1',
    'ten_demo_a',
    JSON.stringify({ name: 'Sarah Connor', email: 'sarah@skynet.com', company: 'Resistance' }),
    '8.8.8.8',
    'United States',
    'Mountain View',
    'ip-api',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
  );

  insertSub.run(
    'sub_demo_2',
    'wgt_demo_a1',
    'ten_demo_a',
    JSON.stringify({ name: 'Miles Dyson', email: 'miles@cyberdyne.com', company: 'Cyberdyne' }),
    '1.1.1.1',
    'Australia',
    'Sydney',
    'ipapi.co',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
  );

  return true;
}

if (require.main === module) {
  try {
    runSeed();
    console.log('Database seeded successfully with demo tenants, widgets, and leads.');
  } catch (error) {
    console.error('Database seed failed:', error);
    process.exit(1);
  }
}

module.exports = { runSeed };
