const config = require('../config');

/**
 * Per-user cache system.
 * Each user (by ID) gets their own cache map with TTL.
 * Automatically evicts stale entries and enforces max size.
 */
class UserCache {
  constructor() {
    // Map<userId, Map<cacheKey, { data, expiresAt }>>
    this._stores = new Map();
  }

  /**
   * Get cached data for a user.
   * @param {string} userId
   * @param {string} key
   * @returns {*} cached data or null if miss/expired
   */
  get(userId, key) {
    const store = this._stores.get(userId);
    if (!store) return null;

    const entry = store.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      store.delete(key);
      return null;
    }

    return entry.data;
  }

  /**
   * Set cached data for a user.
   * @param {string} userId
   * @param {string} key
   * @param {*} data
   * @param {number} [ttlMs] - TTL in ms (defaults to config.CACHE_TTL_MS)
   */
  set(userId, key, data, ttlMs = config.CACHE_TTL_MS) {
    let store = this._stores.get(userId);
    if (!store) {
      store = new Map();
      this._stores.set(userId, store);
    }

    // Enforce max size: evict oldest entry if over limit
    if (store.size >= config.CACHE_MAX_SIZE) {
      const firstKey = store.keys().next().value;
      if (firstKey) store.delete(firstKey);
    }

    store.set(key, {
      data,
      expiresAt: Date.now() + ttlMs,
    });
  }

  /**
   * Invalidate a specific cache entry for a user.
   */
  invalidate(userId, key) {
    const store = this._stores.get(userId);
    if (store) {
      store.delete(key);
    }
  }

  /**
   * Clear all cache entries for a user.
   */
  clear(userId) {
    this._stores.delete(userId);
  }

  /**
   * Clear all caches.
   */
  clearAll() {
    this._stores.clear();
  }

  /**
   * Get stats for debugging.
   */
  stats() {
    const stats = {};
    for (const [userId, store] of this._stores.entries()) {
      stats[userId] = {
        size: store.size,
        keys: Array.from(store.keys()),
      };
    }
    return stats;
  }
}

// Singleton
const userCache = new UserCache();

module.exports = userCache;
