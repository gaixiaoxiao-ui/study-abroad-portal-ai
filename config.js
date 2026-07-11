module.exports = {
  JWT_SECRET: process.env.JWT_SECRET || 'shengxue-guihua-secret-key-2025',
  JWT_EXPIRES_IN: '7d',
  CACHE_TTL_MS: 5 * 60 * 1000,     // 5 minutes default cache TTL
  CACHE_MAX_SIZE: 100,               // max cached items per user
};
