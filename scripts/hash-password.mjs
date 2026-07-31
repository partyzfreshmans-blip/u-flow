#!/usr/bin/env node
// Generates a users.password_hash value in the exact format server/lib.ts's
// hashPassword()/verifyPassword() expect (scrypt "salt:hashHex", 16-byte
// random salt, 64-byte derived key, both hex) — so a row inserted straight
// into Postgres logs in exactly like one created through the app's own
// "create user" flow. Nothing here talks to any database or network —
// purely a local computation; run it, then paste the SQL it prints into
// your own DB client (psql, Supabase's SQL Editor, ...).
//
// Pass the password via the ADMIN_PASSWORD env var, not a CLI argument —
// env vars don't get written to shell history the way a plain argument
// does:
//
//   ADMIN_PASSWORD='your-real-password' node scripts/hash-password.mjs admin administrator
//
// Never paste a real password into a chat/PR/issue/commit message — this
// script exists so you never have to.
import { scryptSync, randomBytes } from 'node:crypto';

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

const username = (process.argv[2] ?? '').trim() || 'admin';
const role = (process.argv[3] ?? '').trim() || 'administrator';
const password = process.env.ADMIN_PASSWORD ?? '';

const validRoles = ['administrator', 'manager', 'admin_staff', 'checker', 'picker', 'driver'];
if (!validRoles.includes(role)) {
  console.error(`Invalid role "${role}". Must be one of: ${validRoles.join(', ')}`);
  process.exit(1);
}
if (!password) {
  console.error('Set ADMIN_PASSWORD first, e.g.:');
  console.error(`  ADMIN_PASSWORD='your-real-password' node scripts/hash-password.mjs ${username} ${role}`);
  process.exit(1);
}

const hash = hashPassword(password);

console.log('--- password_hash (do not share this either — it is enough to attempt offline cracking) ---');
console.log(hash);
console.log('\n--- SQL: run this against your database ---');
console.log(`INSERT INTO users (username, password_hash, role, active, driver_vehicle_id)
VALUES ('${username.replace(/'/g, "''")}', '${hash}', '${role}', true, '')
ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role, active = true;
`);
