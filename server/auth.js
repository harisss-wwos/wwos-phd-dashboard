// Auth helpers: password hashing, JWT issue/verify, role model, and Express middleware.
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET env var is not set.');
  process.exit(1);
}

const TOKEN_TTL = process.env.JWT_TTL || '12h';

// Role hierarchy (higher number = more privilege).
// 'manager' has the same access level as 'admin' (can publish/upload; cannot manage users).
const ROLES = { user: 0, editor: 1, admin: 2, manager: 2, owner: 3 };
const VALID_ROLES = Object.keys(ROLES);

function rank(role) {
  return ROLES[role] != null ? ROLES[role] : -1;
}

async function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
}

async function verifyPassword(plain, hash) {
  if (!hash) return false;
  return bcrypt.compare(plain, hash);
}

function issueToken(user) {
  // Never put the password hash in the token.
  return jwt.sign(
    { sub: String(user._id), username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return null;
  }
}

// Express middleware: attaches req.user if a valid Bearer token is present.
// Does NOT reject — used so public routes can still see who (if anyone) is logged in.
function attachUser(req, res, next) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (m) {
    const payload = verifyToken(m[1]);
    if (payload) req.user = payload;
  }
  next();
}

// Express middleware factory: require a minimum role.
function requireRole(minRole) {
  const min = rank(minRole);
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Login required.' });
    if (rank(req.user.role) < min) return res.status(403).json({ error: 'Insufficient privileges.' });
    next();
  };
}

module.exports = {
  ROLES, VALID_ROLES, rank,
  hashPassword, verifyPassword,
  issueToken, verifyToken,
  attachUser, requireRole,
};
