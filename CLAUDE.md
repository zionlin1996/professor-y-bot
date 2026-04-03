# Professor-Y

A Telegram bot that proxies group messages to an LLM backend and replies with the generated response. No database — purely stateless per process (conversation history lives in memory).

## How it works

The bot activates in group chats whenever it is **@mentioned** — either in a reply or in a standalone message. In private chats, the bot responds to allowed users only (see `PRIVATE_CHAT_ALLOWED_USERS`). Both text and images are supported.

**Forwarded messages are always ignored** — if `msg.forward_origin` is set, the bot silently skips the message regardless of chat type or mention.

**Group trigger — mention inside a reply:**
1. User replies to any message and includes `@botname` in the reply text
2. Bot receives: `> [original message]\n\n[reply text without @mention]`
3. If the reply text is empty (just `@botname`), only the original message is sent as the prompt
4. If the replied-to message contains an image, it is included in the prompt
5. LLM response is formatted to Telegram HTML and sent as a reply

**Group trigger — direct mention (no reply):**
1. User sends a message (optionally with an attached image) that includes `@botname`
2. The whole message (minus the `@mention`) is sent as the prompt
3. LLM response is formatted to Telegram HTML and sent as a reply

**Conversation history** is keyed by `chatId:userId`, so each user has an independent conversation thread with the bot — even within the same group.

## Project structure

```
index.js                      ← entry point, message routing
src/
  bot.js                      ← EnhancedBot (extends node-telegram-bot-api)
  setup.js                    ← dev (polling) vs production (webhook) setup
  llm/
    index.js                  ← LLMClient: history management, backend routing
    ROLE.md                   ← Professor Y persona and communication rules
    BOT.md                    ← Telegram-specific response guidelines (multi-user, formatting)
    backends/
      openai.js               ← OpenAI backend
      claude.js               ← Anthropic Claude backend
      gemini.js               ← Google Gemini backend
      lumo.js                 ← Lumo (Proton) backend
    tools/
      remind.js               ← schedule_reminder tool definition + executor (shared across backends)
  libs/
    parseMessage.js           ← extracts chatId, userId, text from Telegram msg
    formatReply.js            ← converts LLM markdown output to Telegram HTML
    attachments.js            ← getLastImage() and toImageBlock() for image support
    preprocess.js             ← slash-command handler (runs before LLM, returns null to short-circuit)
    subscriber.js             ← Redis Pub/Sub subscriber → bot.sendMessage on notification
Dockerfile                    ← production image (node:20.18.1-alpine, port 80)
captain-definition            ← CapRover deployment config
.env.example                  ← all supported environment variables
```

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Yes | — | Bot token from BotFather |
| `TELEGRAM_BOT_USERNAME` | Yes | — | Bot username without `@` |
| `LLM_BACKEND` | No | `openai` | `openai`, `claude`, `gemini`, or `lumo` |
| `OPENAI_API_KEY` | If openai | — | OpenAI API key |
| `OPENAI_MODEL` | No | `gpt-4o-mini` | OpenAI model name |
| `ANTHROPIC_API_KEY` | If claude | — | Anthropic API key |
| `CLAUDE_MODEL` | No | `claude-haiku-4-5-20251001` | Claude model name |
| `GEMINI_API_KEY` | If gemini | — | Google Gemini API key |
| `GEMINI_MODEL` | No | `gemini-2.5-flash` | Gemini model name |
| `LUMO_API_KEY` | If lumo | — | Lumo (Proton) API key |
| `LUMO_MODEL` | No | `auto` | Lumo model: `auto`, `lumo-fast`, or `lumo-thinking` |
| `LLM_SYSTEM_PROMPT` | No | — | Extra instructions appended after the built-in Professor Y system prompt |
| `PRIVATE_CHAT_ALLOWED_USERS` | No | — | Comma-separated Telegram user IDs allowed to use private chat; empty = no one |
| `EXTERNAL_URL` | Production | — | Public URL for webhook registration |
| `NODE_ENV` | No | — | Set to `production` to enable webhook mode |
| `PORT` | No | `80` | Express server port (production only) |

## Running locally

```sh
cp .env.example .env   # fill in your tokens
yarn install
yarn dev               # polling mode, NODE_ENV=development
```

## Deployment (CapRover)

The project uses a `captain-definition` file pointing to `./Dockerfile`. Pass all environment variables as CapRover app environment variables. `EXTERNAL_URL` must be set to the public HTTPS URL of the app so the webhook is registered on startup.

Production mode (`NODE_ENV=production`) disables polling and starts an Express server on port 80 that receives Telegram updates via `POST /webhook`.

## Telegram setup notes

- **Group Privacy Mode must be disabled** via BotFather (`/setprivacy → Disable`) for the bot to receive `@mention` messages in groups
- The bot responds to text messages, image messages (compressed photos and uncompressed image documents), and stickers

## Adding a new LLM backend

1. Create `src/llm/backends/<name>.js` — implement a class with a single `async complete(messages)` method that accepts an OpenAI-style messages array (`[{ role, content }]`) and returns a string
   - `content` may be a plain string (text-only) or an array of blocks (multimodal). Image blocks use the neutral format `{ type: "image", mediaType, data }` — implement a `normalizeMessages()` method to translate these to your backend's format before the API call
   - If the backend uses a different system prompt format (like Anthropic), extract the `role: 'system'` entry from the array and handle it internally
2. Register the backend in `src/llm/index.js`:
   ```js
   const BACKENDS = {
     openai: () => require('./backends/openai'),
     claude: () => require('./backends/claude'),
     yourbackend: () => require('./backends/yourbackend'), // add here
   };
   ```
3. Add the relevant env vars to `.env.example` and `Dockerfile`
4. Set `LLM_BACKEND=yourbackend` in `.env`

## Conversation threads

Each bot interaction in a group starts a **new thread** with its own isolated conversation history. Replies to any message in the thread (bot or user) continue the same thread without requiring another `@mention`.

- `threads: Map<threadId, messages[]>` — conversation history per thread (UUID key)
- `messageToThread: Map<messageId, threadId>` — tracks which Telegram messages belong to which thread
- After the bot responds, both the user's triggering message and the bot's response are registered in `messageToThread`
- In private chats, one persistent thread is maintained per chat (no branching)
- Capped at 20 messages per thread (oldest trimmed first)
- All state is in-memory and cleared on process restart
- The system prompt is assembled from ordered `.md` files in `src/llm/` (see below); `LLM_SYSTEM_PROMPT` env var appends extra instructions after them
- Each user message is prefixed with `@username: ` (falling back to first name) so the LLM can distinguish between users in a shared thread

## System prompt files

The default system prompt is assembled in `src/llm/index.js` by loading an ordered list of `.md` files from `src/llm/`:

| File | Purpose |
|---|---|
| `ROLE.md` | Professor Y persona — identity, tone, language rules, immutable constraints |
| `BOT.md` | Telegram-specific guidelines — response length, formatting, multi-user awareness |
| `TOOLS.md` | Custom tool instructions — when and how to call each tool (only loaded when `REDIS_URL` is set) |

**Adding a new prompt file:** create the `.md` file in `src/llm/` and add `loadPrompt("YOURFILE.md")` to the array in `index.js`. Order matters — earlier files take higher precedence.

**Placeholder substitution:** use `%BOT_NAME%` anywhere in a prompt file; it will be replaced at load time with `TELEGRAM_BOT_USERNAME` from the environment.

## Git conventions

- Use **conventional commits** for all commit messages (e.g. `feat:`, `fix:`, `chore:`, `docs:`)
- **Never commit unless explicitly asked** — always wait for the user to say so before running `git commit`
- **Always update CLAUDE.md** after any code change — reflect the intent, behaviour, and any new conventions introduced

## Slash commands (preprocess)

Before a message reaches the LLM, `src/libs/preprocess.js` checks whether it exactly matches a registered slash command. If it does, the command handler runs, the bot replies directly, and `null` is returned to skip LLM processing. Non-command messages pass through unchanged.

There are two separate registries with different trigger mechanics:

**Group commands (`COMMANDS`)** — triggered via `@bot /command` (after `@mention` is stripped):
```js
"/mycommand": ({ llm, bot, msg, chatId }) => "reply string",
```

**Private chat commands (`PRIVATE_COMMANDS`)** — triggered by native Telegram bot commands (`/command`), only active in private chats. Handlers may be async; returning `null` suppresses the default reply (use this when the handler sends its own message):
```js
"/mycommand": async ({ llm, bot, msg, chatId, privateThreads }) => "reply string",
```

Commands that use inline keyboards must handle button taps via a `callback_query` listener registered directly in `index.js`. The listener checks `allowedUserIds` and `chat.type === 'private'` before acting.

| Command | Mode | Response |
|---|---|---|
| `/provider` | Group | Current backend name and model (e.g. `gemini / gemini-2.5-flash`) |
| `/start` | Private | Sends a welcome message and attaches a persistent reply keyboard with a "🗑 Clear" button |
| `/clear` | Private | Immediately deletes the current thread and replies "Cleared." |
| `🗑 Clear` | Private | Reply keyboard button — same behaviour as `/clear` |

## Web search

All backends have web search enabled by default — no extra configuration needed.

| Backend | Mechanism |
|---|---|
| Claude | `web_search_20250305` built-in tool; Anthropic executes searches server-side via a standard multi-turn tool loop |
| OpenAI | `web_search_preview` tool via the Responses API; the tool loop is handled server-side automatically |
| Gemini | `googleSearch` grounding tool via `@google/genai` |
| Lumo | No web search — not available via the Lumo API |

## Image support

Images are plumbed from Telegram through to the LLM via a neutral internal format, then translated per-backend before the API call.

**Trigger conditions (groups):** photo or sticker attached to an `@mention` message, or a reply (with or without `@mention`) to a message that contains a photo or sticker. In private chats, any message with a photo or sticker is handled.

**Pipeline:**
1. `getLastImage(msg)` (`src/libs/attachments.js`) — extracts the largest photo size, image document, or sticker thumbnail from a Telegram message
2. `targetAttachment = msgAttachment || replyAttachment` — current message photo takes priority over the replied-to message photo
3. `bot.getFile()` resolves the `file_id` to a download path
4. `toImageBlock(token, file)` (`src/libs/attachments.js`) — downloads the file, base64-encodes it, and returns a neutral block: `{ type: "image", mediaType, data }`
5. `userMessage` is built as a content array: `[{ type: "text", text }, imageBlock]`
6. Each backend's `normalizeMessages()` translates the neutral block to its API format before the call

**Neutral image block format** (stored in thread history):
```js
{ type: "image", mediaType: "image/jpeg", data: "<base64>" }
```

**Per-backend translation:**
| Backend | Image block format |
|---|---|
| Claude | `{ type: "image", source: { type: "base64", media_type, data } }` |
| OpenAI | `{ type: "input_image", image_url: "data:<mediaType>;base64,<data>" }` (text blocks become `input_text`) |
| Gemini | `{ inlineData: { mimeType, data } }` (text blocks become `{ text }`) |

## Response formatting

LLM output (standard Markdown) is converted to Telegram-compatible HTML via `src/libs/formatReply.js`:
- Uses `marked` to render standard Markdown → HTML
- Post-processes to replace unsupported tags (`<strong>→<b>`, `<em>→<i>`, `<h1-6>→<b>`, `<li>→•`, etc.)
- Strips any remaining tags not supported by Telegram
- Falls back to plain text if Telegram rejects the HTML
