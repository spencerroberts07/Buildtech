import jwt from 'jsonwebtoken';
import { query } from './db.js';

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

export function signToken(user) {
  // Role is included so authRequired can gate admin endpoints without an
  // extra DB hit on every request. Re-issued on login; existing tokens
  // without `role` fall back to a DB lookup in adminRequired.
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role || 'admin' },
    SECRET,
    { expiresIn: '7d' }
  );
}

export function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// adminRequired must run AFTER authRequired. Uses the role baked into the
// JWT when present; falls back to a DB lookup for older tokens issued
// before the role-in-token change.
export async function adminRequired(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  let role = req.user.role;
  if (!role) {
    try {
      const r = await query('SELECT role FROM users WHERE id = $1', [req.user.id]);
      role = r.rows[0]?.role;
      req.user.role = role;
    } catch {
      return res.status(500).json({ error: 'auth lookup failed' });
    }
  }
  if (role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}
