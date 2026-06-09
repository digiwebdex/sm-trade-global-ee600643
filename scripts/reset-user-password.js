#!/usr/bin/env node
/**
 * Reset a user password on VPS.
 * Usage: cd server && node ../scripts/reset-user-password.js EMAIL NEW_PASSWORD
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../server/.env') });
const pool = require('../server/db');
const { hashPassword } = require('../server/auth');

const email = process.argv[2];
const newPassword = process.argv[3];

if (!email || !newPassword) {
  console.error('Usage: node scripts/reset-user-password.js EMAIL NEW_PASSWORD');
  process.exit(1);
}

(async () => {
  const hash = await hashPassword(newPassword);
  const [result] = await pool.query(
    'UPDATE users SET password = ? WHERE LOWER(TRIM(email)) = ? OR LOWER(TRIM(username)) = ?',
    [hash, email.toLowerCase().trim(), email.toLowerCase().trim()]
  );
  if (result.affectedRows === 0) {
    console.error('No user found for:', email);
    const [users] = await pool.query('SELECT id, username, email, role FROM users');
    console.log('Existing users:', users);
    process.exit(1);
  }
  console.log('Password updated for:', email);
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
