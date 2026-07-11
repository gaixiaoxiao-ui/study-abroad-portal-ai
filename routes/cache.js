const express = require('express');
const { requireAuth } = require('../middleware/auth');
const userCache = require('../utils/cache');

const router = express.Router();

/**
 * GET /cache/stats — 查看当前缓存状态（需登录）
 */
router.get('/stats', requireAuth, (req, res) => {
  const allStats = userCache.stats();
  // Only show current user's stats for privacy
  const userStats = allStats[req.userId] || { size: 0, keys: [] };
  res.json({
    userId: req.userId,
    cacheStats: userStats,
  });
});

/**
 * DELETE /cache — 清除当前用户的全部缓存
 */
router.delete('/', requireAuth, (req, res) => {
  userCache.clear(req.userId);
  res.json({ message: '缓存已清除' });
});

/**
 * DELETE /cache/:key — 清除指定缓存项
 */
router.delete('/:key', requireAuth, (req, res) => {
  userCache.invalidate(req.userId, req.params.key);
  res.json({ message: `缓存项 ${req.params.key} 已清除` });
});

module.exports = router;
