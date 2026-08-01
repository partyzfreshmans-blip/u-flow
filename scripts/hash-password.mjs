#!/usr/bin/env node
// Generates a password_hash value in the exact format server/lib.ts's
// hashPassword()/verifyPassword() expect (scrypt "salt:hashHex", 16-byte
// random salt, 64-byte derived key, both hex), then prints a tab-separated
// row you paste straight into the "Users" tab of the spreadsheet — that tab
// is the only place user accounts live (see server/lib.ts's readUsers), so
// there's no database or network call here, just a local computation.
//
// Pass the password via the ADMIN_PASSWORD env var, not a CLI argument —
// env vars don't get written to shell history the way a plain argument
// does:
//
//   ADMIN_PASSWORD='your-real-password' node scripts/hash-password.mjs admin administrator
//
// Optionally pass a driver_vehicle_id as a 3rd argument (only meaningful
// for role=driver):
//
//   ADMIN_PASSWORD='...' node scripts/hash-password.mjs driver1 driver veh-a
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
const driverVehicleId = (process.argv[4] ?? '').trim();
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
// Matches USERS_HEADER in server/lib.ts exactly, left to right.
const row = [username, hash, role, 'TRUE', driverVehicleId, new Date().toISOString()];

console.log('--- password_hash (do not share this either — it is enough to attempt offline cracking) ---');
console.log(hash);
console.log('\n--- Paste this row into the "Users" tab (select the first empty row, column A, then paste) ---');
console.log(row.join('\t'));
