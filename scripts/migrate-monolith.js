/**
 * ETL Migration Runner: Monolith to Decoupled PostgreSQL Schemas
 * Usage: node scripts/migrate-monolith.js
 */

const { Client } = require('pg');

async function runMigration() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL || 'postgresql://ems_admin:ems_secure_password@localhost:5432/ems_platform'
  });

  await client.connect();
  console.log('[Migration] Connected to PostgreSQL.');

  try {
    await client.query('BEGIN');

    // 1. Ensure schemas exist
    await client.query(`
      CREATE SCHEMA IF NOT EXISTS core;
      CREATE SCHEMA IF NOT EXISTS eps;
      CREATE SCHEMA IF NOT EXISTS wms;
      CREATE SCHEMA IF NOT EXISTS mro;
      CREATE SCHEMA IF NOT EXISTS prm;
    `);

    console.log('[Migration] Isolated schemas initialized successfully.');

    await client.query('COMMIT');
    console.log('[Migration] Migration completed successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Migration] Migration failed, transaction rolled back:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration();
