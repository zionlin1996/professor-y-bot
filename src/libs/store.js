const redis = require('./redis')

const TTL = 7 * 24 * 60 * 60 // 7 days in seconds

module.exports = {
  async get (key) {
    return redis ? redis.get(key) : null
  },
  /**
   * @param {string} key
   * @param {string} value
   * @param {number|null} [ttl=TTL] - seconds; pass null for no expiry
   */
  async set (key, value, ttl = TTL) {
    if (!redis) return
    if (ttl) await redis.setex(key, ttl, value)
    else await redis.set(key, value)
  }
}
