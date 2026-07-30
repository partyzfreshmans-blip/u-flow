// Verifies DATABASE_URL actually connects and that basic reads/writes work
// against the schema in db/migrations/0001_init.sql — run this once after
// setting DATABASE_URL (locally in .env, or as a Vercel project environment
// variable pulled down with `vercel env pull`) to confirm the database is
// reachable before wiring any real feature up to it.
//
// Does NOT touch any table the app will eventually use for real data: it
// creates its own throwaway `_db_smoke_test` table, writes a row, reads it
// back, then drops the table — safe to run against a database that already
// has the real schema (or an empty one; it only needs CREATE/DROP TABLE
// privileges).
//
// Run with: node scripts/db-smoke-test.mjs
// (loads .env itself via dotenv, same as scripts/seed-promotions.mjs)

import 'dotenv/config';
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set — see .env.example');
  process.exit(1);
}

const sql = postgres(url, { max: 1 });

try {
  await sql`SELECT 1 AS ok`;
  console.log('✓ connected');

  await sql`CREATE TABLE IF NOT EXISTS _db_smoke_test (id SERIAL PRIMARY KEY, note TEXT, at TIMESTAMPTZ DEFAULT now())`;
  const [inserted] = await sql`INSERT INTO _db_smoke_test (note) VALUES ('u-flow smoke test') RETURNING id, note, at`;
  console.log('✓ wrote row', inserted);

  const [read] = await sql`SELECT id, note, at FROM _db_smoke_test WHERE id = ${inserted.id}`;
  console.log('✓ read row back', read);

  await sql`DROP TABLE _db_smoke_test`;
  console.log('✓ cleaned up test table');

  const tables = await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' ORDER BY table_name
  `;
  console.log(`\nTables currently in this database (${tables.length}):`);
  for (const t of tables) console.log(`  - ${t.table_name}`);

  console.log('\nAll checks passed.');
} catch (err) {
  console.error('✗ smoke test failed:', err.message ?? err);
  process.exit(1);
} finally {
  await sql.end();
}
