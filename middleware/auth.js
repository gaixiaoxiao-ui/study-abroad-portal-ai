const jwt = require('jsonwebtoken');
const config = require('../config');
const userStore = require('../utils/userStore');

/**
 * Required auth middleware.
 * Rejects requests without a valid JWT.
 */
function requireAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ error: '未登录，请先登录' });
  }

  try {
    const decoded = jwt.verify(token, config.JWT_SECRET);
    const user = userStore.findById(decoded.userId);
    if (!user) {
      return res.status(401).json({ error: '用户不存在' });
    }
    req.user = userStore.sanitizeUser(user);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    console.error('[requireAuth] token:', (token||'EMPTY').slice(0,30), 'err:', err.name, err.message);
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: '登录已过期，请重新登录' });
    }
    return res.status(401).json({ error: '无效的登录凭证' });
  }
}

/**
 * Optional auth middleware.
 * Attaches req.user if token is present, but doesn't reject if missing.
 */
function optionalAuth(req, res, next) {
  const token = extractToken(req);
  if (token) {
    try {
      const decoded = jwt.verify(token, config.JWT_SECRET);
      const user = userStore.findById(decoded.userId);
      if (user) {
        req.user = userStore.sanitizeUser(user);
        req.userId = decoded.userId;
      }
    } catch {
      // Token invalid — just proceed without user
    }
  }
  next();
}

function extractToken(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  // Also check query param (useful for WebSocket/SSE)
  if (req.query && req.query.token) {
    return req.query.token;
  }
  // Cookie-based session persistence (manual parse, no cookie-parser dep)
  if (req.headers.cookie) {
    const match = req.headers.cookie.match(/(?:^|;\s*)student_token=([^;]*)/);
    if (match) return match[1];
  }
  return null;
}

/**
 * Parent auth middleware.
 * Requires user to be authenticated AND have role === 'parent'.
 */
function requireParent(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ error: '未登录，请先登录' });
  }

  try {
    const decoded = jwt.verify(token, config.JWT_SECRET);
    const user = userStore.findById(decoded.userId);
    if (!user) {
      return res.status(401).json({ error: '用户不存在' });
    }
    if (user.role !== 'parent') {
      return res.status(403).json({ error: '仅限家长账户访问' });
    }
    req.user = userStore.sanitizeUser(user);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: '登录已过期，请重新登录' });
    }
    return res.status(401).json({ error: '无效的登录凭证' });
  }
}

/**
 * Student role middleware.
 * Requires user to NOT be a parent account.
 */
function requireStudent(req, res, next) {
  if (req.user && req.user.role === 'parent') {
    return res.status(403).json({ error: '此功能仅限学生账号使用' });
  }
  next();
}

module.exports = { requireAuth, optionalAuth, requireParent, requireStudent };
