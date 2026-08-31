/**
 * Error reply helper.
 *
 * Two responsibilities:
 *  1. `serializeError()` — turn an arbitrary thrown value into a readable,
 *     bounded string (name, message, code, Telegram API response body, cause
 *     chain, short stack in non-production) so error replies carry the real
 *     failure instead of a fixed "something went wrong" placeholder.
 *  2. `sendError()` — send that string as an HTML <pre> block and schedule its
 *     deletion after a TTL (default 5 minutes) so noisy diagnostics do not
 *     linger in group chats.
 *
 * Deletion uses an in-process `setTimeout` + `bot.deleteMessage`. Timers do not
 * survive a restart, and Telegram only lets a bot delete its own messages
 * within 48 hours — both acceptable for a 5-minute TTL on a single instance.
 */

const DEFAULT_TTL_MS = 5 * 60 * 1000
const MAX_BODY_LENGTH = 1500
const MAX_STACK_FRAMES = 3

function escapeHtml (value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function safeJson (value) {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function describe (error, depth = 0) {
  if (error === null || error === undefined) return 'Unknown error'
  if (typeof error === 'string') return error
  if (typeof error !== 'object') return String(error)
  if (depth > 3) return '[nested error omitted]'

  const parts = []
  const name = error.name || error.constructor?.name
  const message = error.message || error.description || ''
  parts.push([name, message].filter(Boolean).join(': ') || 'Unknown error')

  const code = error.code ?? error.statusCode ?? error.status
  if (code !== undefined && code !== null) parts.push(`code: ${code}`)

  // node-telegram-bot-api attaches the raw Telegram API payload here
  const body = error.response?.body
  if (body) {
    parts.push(
      `response: ${typeof body === 'string' ? body : safeJson(body)}`
    )
  }

  if (error.cause && error.cause !== error) {
    parts.push(`cause: ${describe(error.cause, depth + 1)}`)
  }

  if (!message && code === undefined && !body) {
    const json = safeJson(error)
    if (json && json !== '{}') return json
  }

  return parts.join('\n')
}

/**
 * @param {unknown} error   thrown value of any shape
 * @param {object} [opts]
 * @param {boolean} [opts.stack]  include a short stack trace (default: off in production)
 * @returns {string} bounded, human-readable representation of the error
 */
function serializeError (error, opts = {}) {
  const includeStack =
    opts.stack ?? process.env.NODE_ENV !== 'production'

  let text = describe(error)

  if (includeStack && error?.stack) {
    const trace = String(error.stack)
      .split('\n')
      .slice(1, 1 + MAX_STACK_FRAMES)
      .map((line) => line.trim())
      .filter(Boolean)
      .join('\n')
    if (trace) text += `\n${trace}`
  }

  if (text.length > MAX_BODY_LENGTH) {
    text = `${text.slice(0, MAX_BODY_LENGTH)}…`
  }

  return text
}

/**
 * Delete a message after `ttlMs`. Failures are logged, never thrown.
 * @returns {NodeJS.Timeout|null}
 */
function scheduleDeletion (bot, chatId, messageId, ttlMs = DEFAULT_TTL_MS) {
  if (!messageId || !(ttlMs > 0)) return null

  const timer = setTimeout(() => {
    Promise.resolve()
      .then(() => bot.deleteMessage(chatId, messageId))
      .catch((err) => {
        console.error(
          '[sendError] failed to delete error message:',
          err?.message || err
        )
      })
  }, ttlMs)

  // Never hold the event loop open just to delete an error notice
  if (typeof timer.unref === 'function') timer.unref()
  return timer
}

/**
 * Send a serialized error reply that deletes itself after `ttlMs`.
 *
 * @param {import('../../bot')} bot
 * @param {number|string} chatId
 * @param {unknown} error
 * @param {object} [options]  sendMessage options, plus:
 * @param {number} [options.ttlMs=300000]  lifetime before self-deletion
 * @param {string} [options.prefix]        short human-readable context line
 * @returns {Promise<object|null>} the sent message, or null if delivery failed
 */
async function sendError (bot, chatId, error, options = {}) {
  const { ttlMs = DEFAULT_TTL_MS, prefix = '', ...sendOptions } = options
  const body = serializeError(error)
  const head = prefix ? `${prefix}\n` : ''

  let sent
  try {
    sent = await bot.sendMessage(
      chatId,
      `${escapeHtml(head)}<pre>${escapeHtml(body)}</pre>`,
      { parse_mode: 'HTML', ...sendOptions }
    )
  } catch (htmlErr) {
    try {
      sent = await bot.sendMessage(chatId, `${head}${body}`, sendOptions)
    } catch (plainErr) {
      console.error(
        '[sendError] failed to deliver error message:',
        plainErr?.message || plainErr
      )
      return null
    }
  }

  scheduleDeletion(bot, chatId, sent?.message_id, ttlMs)
  return sent
}

module.exports = sendError
module.exports.sendError = sendError
module.exports.serializeError = serializeError
module.exports.scheduleDeletion = scheduleDeletion
module.exports.ERROR_MESSAGE_TTL_MS = DEFAULT_TTL_MS
