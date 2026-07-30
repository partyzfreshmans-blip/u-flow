// Postgres connection client — infrastructure for a FUTURE migration phase.
//
// Nothing in server/lib.ts or api/*.ts imports this yet. The live app reads
// and writes Google Sheets exactly as before; this module exists so that the
// moment a DATABASE_URL is set, the client is ready to use without further
// setup work. See db/README.md for the schema this connects to and the
// overall migration plan.
//
// Library choice: postgres.js (the `postgres` package), not Prisma or
// Drizzle —
//   - No generated query-engine binary to download/cold-start (Prisma's
//     binary engine adds real latency on Vercel's serverless functions,
//     which spin up fresh on most invocations under light traffic).
//   - No schema-codegen step (Drizzle) needed for a phase that is only
//     laying groundwork — plain tagged-template SQL against the migration
//     file above is enough, and stays easy to read next to it.
//   - Speaks the standard Postgres wire protocol, so it works unchanged
//     against a local dev Postgres, Neon (via its pooled connection
//     string), or Supabase — it doesn't lock this code to one provider
//     ahead of the user's own choice.
//   - Tagged-template queries (sql`select * from x where id = ${id}`) are
//     parameterized automatically, so there's no hand-rolled SQL-injection
//     risk to review later.
import postgres from 'postgres';

let client: postgres.Sql | null = null;

/**
 * Lazily creates (once per process) and returns the shared Postgres client.
 * Throws if DATABASE_URL isn't set — callers should only reach this once a
 * migration phase actually wires a handler up to Postgres; nothing does yet.
 *
 * `max: 1` matches the standard serverless-function pattern: each function
 * instance handles requests one at a time, and Neon/Supabase's own pooler
 * (pgbouncer) already sits in front of the database, so the client itself
 * doesn't need to keep an internal pool.
 */
export function getDb(): postgres.Sql {
  if (client) return client;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set — see .env.example');
  client = postgres(url, {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
    // No explicit `ssl` override: Neon/Supabase connection strings already
    // carry `?sslmode=require`, and postgres.js honors that from the URL
    // itself — forcing it here would break connecting to a plain local
    // Postgres instance (e.g. for running db/scripts/smoke-test.mjs in dev).
  });
  return client;
}
