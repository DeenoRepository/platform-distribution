const { Client } = require('pg');
const { MonolithMigrator } = require('./migrate-monolith.cjs');

async function runMigration() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL || 'postgresql://ems_admin:ems_secure_password@localhost:5432/ems_platform'
  });

  try {
    await client.connect();
    console.log('[Migration] Connected to PostgreSQL.');

    const migrator = new MonolithMigrator(client);
    const result = await migrator.migrateAll();

    if (!result.passed) {
      console.error('[Migration] Migration completed with errors:', result.errors);
      process.exit(1);
    }

    console.log('[Migration] Successfully migrated entities:');
    for (const item of result.counts) {
      console.log(`  - ${item.sourceTable} -> ${item.targetTable}: ${item.count} rows`);
    }
  } catch (err) {
    console.error('[Migration] Fatal error connecting to database:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  runMigration();
}

module.exports = { runMigration };
