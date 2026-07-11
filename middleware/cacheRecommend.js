const crypto = require('crypto');
const userCache = require('../utils/cache');

/**
 * Middleware to cache recommendation responses per user.
 * Caches based on userId + body hash.
 * Only applies when user is authenticated.
 */
function cacheRecommend(req, res, next) {
  // Only cache for authenticated users
  if (!req.userId) return next();

  const bodyHash = crypto
    .createHash('md5')
    .update(JSON.stringify(req.body))
    .digest('hex');

  const cacheKey = `recommend:${bodyHash}`;

  // Check cache
  const cached = userCache.get(req.userId, cacheKey);
  if (cached) {
    console.log(`[Cache HIT] user=${req.userId.slice(0, 10)}... key=${cacheKey}`);
    return res.json({ ...cached, _cached: true });
  }

  // Store original res.json to intercept response
  const originalJson = res.json.bind(res);
  res.json = function (body) {
    if (res.statusCode === 200 && body && !body.error) {
      console.log(`[Cache SET] user=${req.userId.slice(0, 10)}... key=${cacheKey}`);
      userCache.set(req.userId, cacheKey, body);
    }
    return originalJson(body);
  };

  next();
}

module.exports = { cacheRecommend };
