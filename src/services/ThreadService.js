const { randomBytes } = require('crypto')
const { toImageBlock } = require('../libs/attachments')

const threadKey = (id) => `thread:${id}`
// Telegram message_id is only unique within a chat — always scope by chatId.
const msgKey = (chatId, id) => `msg:${chatId}:${id}`

/**
 * Lightweight thread data model. Holds history — no I/O.
 * All persistence is handled by ThreadService.
 */
class Thread {
  constructor (id, history = [], ephemeral = false, chatId = null) {
    this.id = id
    this.history = history
    this.ephemeral = ephemeral
    this.chatId = chatId
  }

  append (role, content) {
    this.history.push({ role, content })
  }

  toPublicUrl () {
    const base = process.env.EXTERNAL_URL || 'http://localhost'
    return `${base}/archive/${this.id}`
  }

  serialize () {
    // Compact image blocks for Redis storage: replace base64 data with lightweight refs.
    // image_ref carries fileId so the image can be re-fetched when the thread is loaded.
    // Blocks without a fileId (shouldn't happen in practice) are dropped gracefully.
    return this.history.map((msg) => {
      if (!Array.isArray(msg.content)) return msg
      const compacted = msg.content
        .map((b) => {
          if (b.type !== 'image') return b
          return b.fileId
            ? { type: 'image_ref', fileId: b.fileId, mediaType: b.mediaType }
            : null
        })
        .filter(Boolean)
      if (!compacted.length) return { ...msg, content: '[image]' }
      return { ...msg, content: compacted }
    })
  }
}

/**
 * Per-request service for thread lifecycle and message persistence.
 *
 * Dependencies injected via constructor for testability:
 *   store  — src/libs/store (Redis wrapper)
 *   db     — Prisma client or null
 *   user   — UserService instance (provides stealth flag)
 *
 * thread.ephemeral drives all storage branching:
 *   ephemeral=true  — stealth PM: Thread row in DB; history + msgKey tracking in Redis only
 *   ephemeral=false — regular: groups and non-stealth PM; Thread row + Message rows in DB; resolved via messageId/replyMessageId
 */
class ThreadService {
  constructor ({ store, db, user } = {}) {
    this._store = store
    this._db = db
    this._user = user
    this._pendingMessageId = null
    /** The resolved/created Thread for this request. Set by resolveOrCreate(). */
    this.current = null
    /** Memoizes _findThreadId() per replyToId — lockKeyFor() and resolve() both call it for the same incoming message. */
    this._threadIdCache = new Map()
  }

  // ---------------------------------------------------------------------------
  // Factory / lifecycle
  // ---------------------------------------------------------------------------

  async create ({ chatId, ephemeral = false } = {}) {
    const id = randomBytes(16).toString('hex')
    chatId = String(chatId ?? '')
    await this._db.thread.create({
      data: { id, chatId, ephemeral }
    })
    if (ephemeral) {
      await this._store.set(threadKey(id), '[]')
    }
    return new Thread(id, [], ephemeral, chatId)
  }

  /**
   * Load a regular thread by ID from DB messages.
   * Used by the archive route. Ephemeral threads have no Message rows and are
   * intentionally not accessible here — they return empty → 404.
   */
  async load (threadId) {
    const messages = await this._db.message.findMany({
      where: { threadId },
      orderBy: { createdAt: 'asc' }
    })
    const entries = await Promise.all(
      messages.map(async (m) => {
        let userContent
        if (m.attachmentFileId) {
          try {
            const imageBlock = await toImageBlock({
              file_id: m.attachmentFileId
            })
            userContent = m.content
              ? [{ type: 'text', text: m.content }, imageBlock]
              : [imageBlock]
          } catch {
            userContent = m.content || '[image]'
          }
        } else {
          userContent = m.content || '[message]'
        }
        return [
          { role: 'user', content: userContent },
          ...(m.response ? [{ role: 'assistant', content: m.response }] : [])
        ]
      })
    )
    return new Thread(threadId, entries.flat())
  }

  /**
   * Cheap lookup of which thread a replyToId belongs to, without loading
   * full history. Used both by resolve() and by lockKeyFor(), which are
   * both called for the same incoming message — memoized so the DB/Redis
   * lookup runs once per request rather than twice.
   *
   * Telegram message IDs are per-chat, so the lookup is always scoped by
   * chatId to avoid cross-chat collisions.
   */
  async _findThreadId (replyToId, chatId) {
    chatId = String(chatId ?? '')
    const cacheKey = `${chatId}:${replyToId}`
    if (this._threadIdCache.has(cacheKey)) return this._threadIdCache.get(cacheKey)

    let found = null
    if (this._db) {
      const msg = await this._db.message.findFirst({
        where: {
          thread: { chatId },
          OR: [
            { messageId: String(replyToId) },
            { replyMessageId: String(replyToId) }
          ]
        },
        select: { threadId: true }
      })
      if (msg) found = { id: msg.threadId, ephemeral: false }
    }

    if (!found) {
      const threadId = await this._store.get(msgKey(chatId, replyToId))
      if (threadId) found = { id: threadId, ephemeral: true }
    }

    this._threadIdCache.set(cacheKey, found)
    return found
  }

  /**
   * Resolves the mutex key that should guard the whole
   * resolveOrCreate -> appendPrompt -> chat -> updateReply exchange for this
   * incoming message. Returns null when the message will start a brand-new
   * thread (fresh random ID, nothing else can be contending for it yet).
   */
  async lockKeyFor (incoming) {
    if (!incoming.replyToId) return null
    const found = await this._findThreadId(incoming.replyToId, incoming.chatId)
    return found?.id ?? null
  }

  async resolve (replyToId, chatId) {
    chatId = String(chatId ?? '')
    const found = await this._findThreadId(replyToId, chatId)
    if (!found) return null

    // Non-ephemeral: full history lives in the DB.
    if (!found.ephemeral) {
      const thread = await this.load(found.id)
      thread.chatId = chatId
      return thread
    }

    // Ephemeral: history lives in Redis.
    const raw = await this._store.get(threadKey(found.id))
    const serialized = raw ? JSON.parse(raw) : []
    const history = await Promise.all(
      serialized.map(async (msg) => {
        if (!Array.isArray(msg.content)) return msg
        const expanded = await Promise.all(
          msg.content.map((b) => {
            if (b.type !== 'image_ref') return b
            try {
              return toImageBlock({ file_id: b.fileId })
            } catch {
              return { type: 'text', text: '[image]' }
            }
          })
        )
        return { ...msg, content: expanded }
      })
    )
    return new Thread(found.id, history, true, chatId)
  }

  async resolveOrCreate (incoming) {
    if (incoming.replyToId) {
      this.current = await this.resolve(incoming.replyToId, incoming.chatId)
    }
    if (
      !this.current &&
      ((incoming.isGroup && incoming.isMention) || incoming.isPrivate)
    ) {
      const ephemeral = incoming.isPrivate && !!this._user?.current?.stealth
      this.current = await this.create({ chatId: incoming.chatId, ephemeral })
    }

    return this.current
  }

  // ---------------------------------------------------------------------------
  // Message operations — all use this.current set by resolveOrCreate()
  // ---------------------------------------------------------------------------

  /**
   * Append the user message to history and persist before calling the LLM.
   * Expects a Prompt DTO: text (DB row), content (history / LLM), userId, messageId, attachment.
   *
   * ephemeral: tracks user messageId → threadId in Redis only.
   * regular: creates a Message row in DB.
   */
  async appendPrompt (prompt) {
    const thread = this.current
    thread.append('user', prompt.content)

    if (thread.ephemeral) {
      await this._store.set(msgKey(thread.chatId, prompt.messageId), thread.id)
      return
    }
    if (!this._db) return
    const record = await this._db.message.create({
      data: {
        threadId: thread.id,
        userId: prompt.userId ? String(prompt.userId) : null,
        messageId: prompt.messageId ?? null,
        content: String(prompt.text),
        attachmentFileId: prompt.attachment?.fileId ?? null,
        attachmentMediaType: prompt.attachment?.mediaType ?? null
      }
    })
    this._pendingMessageId = record.id
  }

  /**
   * Finalize the exchange after the bot reply is sent.
   * replyMessageId — Telegram message_id of the bot's reply (enables future thread continuation).
   *
   * ephemeral: serializes history to Redis + tracks bot reply msgKey → threadId.
   * regular: updates the pending Message row with response, replyModel, replyMessageId.
   */
  async updateReply (replyMessageId, { replyModel = '' } = {}) {
    const thread = this.current

    if (thread.ephemeral) {
      await this._store.set(
        threadKey(thread.id),
        JSON.stringify(thread.serialize())
      )
      await this._store.set(msgKey(thread.chatId, replyMessageId), thread.id)
      return
    }

    if (!this._db || !this._pendingMessageId) return
    const last = thread.history[thread.history.length - 1]
    if (last?.role !== 'assistant') return
    try {
      await this._db.message.update({
        where: { id: this._pendingMessageId },
        data: {
          response: String(last.content),
          replyModel: String(replyModel),
          replyMessageId: String(replyMessageId)
        }
      })
    } catch (err) {
      console.error('[ThreadService.updateReply] DB error:', err)
    }
  }
}

module.exports = ThreadService
