const Redis = require('ioredis')

/**
 * Shared Redis client. Null when REDIS_PASSWORD is not set (local dev without Redis).
 * Note: pub/sub requires a dedicated connection — subscriber.js manages its own.
 */
module.exports = process.env.REDIS_PASSWORD
  ? new Redis({
    host: 'srv-captain--redis',
    port: 6379,
    password: process.env.REDIS_PASSWORD
  })
  : null
