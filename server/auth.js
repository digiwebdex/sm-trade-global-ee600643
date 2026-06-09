const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';
const TOKEN_TTL = '7d';

function signToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, username: user.username },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL },
  );
}

async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

async function verifyPassword(plain, stored) {
  if (!stored) return false;
  if (stored.startsWith('$2')) {
    return bcrypt.compare(plain, stored);
  }
  return plain === stored;
}

async function maybeUpgradePasswordHash(pool, userId, plain, stored) {
  if (stored.startsWith('$2')) return;
  const hash = await hashPassword(plain);
  await pool.query('UPDATE users SET password = ? WHERE id = ?', [hash, userId]);
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function sanitizeUser(row) {
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    role: row.role,
    email: row.email,
    createdAt: row.created_at || row.createdAt,
  };
}

module.exports = {
  signToken,
  hashPassword,
  verifyPassword,
  maybeUpgradePasswordHash,
  requireAuth,
  sanitizeUser,
};
