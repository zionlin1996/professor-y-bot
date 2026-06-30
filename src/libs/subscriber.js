const Redis = require('ioredis')

/**
 * Connects to Redis and subscribes to the notifications channel.
 * When a job fires from the scheduler service, sends a Telegram message
 * to the chat_id specified in the payload.
 *
 * Expected payload shape: { chat_id: number, text: string }
 */
function startSubscriber (bot) {
  if (!process.env.REDIS_PASSWORD) {
    console.log('[subscriber] REDIS_PASSWORD not set — skipping pub/sub')
    return
  }
  // @todo: make Redis connection configurable via env var
  const subscriber = new Redis({
    host: 'srv-captain--redis',
    port: 6379,
    password: process.env.REDIS_PASSWORD
  })

  subscriber.subscribe('notifications', (err) => {
    if (err) {
      console.error('[subscriber] failed to subscribe:', err.message)
      return
    }
    console.log('[subscriber] listening on channel: notifications')
  })

  subscriber.on('message', async (_channel, raw) => {
    try {
      const { chat_id: chatId, text } = JSON.parse(raw)
      if (!chatId || !text) return
      await bot.sendMessage(chatId, text)
    } catch (err) {
      console.error('[subscriber] failed to handle notification:', err.message)
    }
  })
}

module.exports = startSubscriber
