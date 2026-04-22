# Professor-Y

A Telegram bot that proxies group messages to an LLM backend and replies with the generated response. Conversation history lives in Redis (or in-memory when Redis is unavailable). A Prisma database layer is wired up for persistent structured data. Current models: `UserProfile` (free-form Markdown notes per user, read/written via LLM tool calls).

## How it works

The bot activates in group chats whenever it is **@mentioned** — either in a reply or in a standalone message. In private chats, the bot responds to allowed users only (see `PRIVATE_CHAT_ALLOWED_USERS`). Both text and images are supported.

**Forwarded messages are always ignored** — if `msg.forward_origin` is set, the bot silently skips the message regardless of chat type or mention.

**`!noreply` suppresses the LLM** — if the user message contains `!noreply` anywhere, preprocessing returns `null` immediately and the message is never sent to the LLM. No reply is sent. Handled in `src/libs/preprocess.js`.

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
    index.js                  ← LLMClient: backend routing, chat orchestration
    Thread.js                 ← Thread class: history, persistence, message↔thread mapping
    ROLE.md                   ← Professor Y persona and communication rules
    BOT.md                    ← Telegram-specific response guidelines (multi-user, formatting)
    backends/
      openai.js               ← OpenAI backend
      claude.js               ← Anthropic Claude backend
      gemini.js               ← Google Gemini backend
      lumo.js                 ← Lumo (Proton) backend
    tools/
      remind.js               ← schedule_reminder tool definition + executor (shared across backends)
      fetch-url.js            ← fetch_url tool: fetches a URL via Jina Reader and returns markdown content
      user-profile.js         ← get_user_profile / update_user_profile tools: read/write per-user Markdown notes in DB
  libs/
    parseMessage.js           ← extracts chatId, userId, text from Telegram msg
    formatReply.js            ← converts LLM markdown output to Telegram HTML
    attachments.js            ← getLastImage() and toImageBlock() for image support
    preprocess.js             ← slash-command handler (runs before LLM, returns null to short-circuit)
    exportHtml.js             ← renders thread history as self-contained HTML (used by GET /archive/:hash)
    redis.js                  ← shared Redis client (null when REDIS_PASSWORD unset)
    store.js                  ← thin wrapper around redis.js: null-guard + TTL, used by Thread
    db.js                     ← null-safe Prisma client singleton (null when DATABASE_URL unset)
    subscriber.js             ← Redis Pub/Sub subscriber → bot.sendMessage on notification
prisma/
  schema.prisma               ← Production schema (PostgreSQL; empty — add models here)
  schema.dev.prisma           ← Development schema (SQLite; mirrors schema.prisma)
  migrations/                 ← auto-generated migration files (created when models are added)
scripts/
  start.sh                    ← container entrypoint: runs prod:db:setup then yarn start
  setup-db.js                 ← NODE_ENV-aware DB setup: SQLite for dev, PostgreSQL for prod
Dockerfile                    ← production image (node:20.18.1-alpine, port 80)
captain-definition            ← CapRover deployment config
.env.example                  ← all supported environment variables
```

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Yes | — | Bot token from BotFather |
| `TELEGRAM_BOT_USERNAME` | Yes | — | Bot username without `@` |
| `OPENAI_API_KEY` | Optional | — | OpenAI API key; enables OpenAI models in `/model` |
| `ANTHROPIC_API_KEY` | Optional | — | Anthropic API key; enables Claude models in `/model` |
| `GEMINI_API_KEY` | Optional | — | Google Gemini API key; enables Gemini models in `/model` |
| `LUMO_API_KEY` | Optional | — | Lumo API key; enables Lumo models in `/model` |
| `GOOGLE_MAPS_API_KEY` | Optional | — | Google Maps API key; required for `search_map` tool (Places API + Geocoding API) |
| `GITHUB_TOKEN` | Optional | — | GitHub Personal Access Token (read scope); required for GitHub MCP code search tools on the Claude backend |
| `LLM_SYSTEM_PROMPT` | No | — | Extra instructions appended after the built-in Professor Y system prompt |
| `PRIVATE_CHAT_ALLOWED_USERS` | No | — | Comma-separated Telegram user IDs allowed to use private chat; empty = no one |
| `EXTERNAL_URL` | Production | — | Public URL for webhook registration |
| `TELEGRAM_WEBHOOK_SECRET` | Recommended | — | Secret token registered with Telegram (`openssl rand -hex 32`); verified via `X-Telegram-Bot-Api-Secret-Token` header to reject forged webhook requests |
| `DATABASE_URL` | No | — | Prisma database URL. SQLite: `file:./prisma/dev.db`. PostgreSQL: `postgresql://user:pass@host:5432/db`. When unset, `getDb()` returns `null` and no DB is used. |
| `NODE_ENV` | No | — | Set to `production` to enable webhook mode |
| `PORT` | No | `80` | Express server port (production only) |

## Running locally

```sh
cp .env.example .env   # fill in your tokens
yarn install
yarn prisma generate   # generate Prisma client (re-run after any schema change)
yarn dev               # polling mode, NODE_ENV=development
```

## Database (Prisma)

The project uses **Prisma 6** as its ORM. Two schema files handle the dev/prod split:

| File | Provider | Used by |
|---|---|---|
| `prisma/schema.prisma` | PostgreSQL | production (CapRover) |
| `prisma/schema.dev.prisma` | SQLite | local development |

Add models to both schema files when needed, then run the appropriate migrate/push command.

**Local dev (SQLite)** — zero setup required:
```sh
DATABASE_URL=file:./prisma/dev.db   # in .env
yarn dev:db:setup                   # generates client + pushes schema
# or to create a named migration:
yarn dev:db:generate && yarn db:migrate --name <migration-name>
```

**Production (PostgreSQL on CapRover)**:
1. Provision a PostgreSQL app in CapRover and get the connection string
2. Set `DATABASE_URL=postgresql://user:pass@host:5432/dbname` as a CapRover env var
3. `scripts/start.sh` runs `yarn prod:db:setup` (generate + migrate/push) before starting the app

**npm scripts reference:**

| Script | Action |
|---|---|
| `yarn setup:db` | Auto-setup based on `NODE_ENV` (calls `scripts/setup-db.js`) |
| `yarn dev:db:setup` | Generate dev client + push SQLite schema |
| `yarn dev:db:generate` | Generate Prisma client from `schema.dev.prisma` |
| `yarn dev:db:push` | Push schema changes to SQLite (no migration file) |
| `yarn dev:db:studio` | Open Prisma Studio for SQLite |
| `yarn prod:db:setup` | Generate prod client + push/migrate PostgreSQL schema |
| `yarn db:generate` | Generate Prisma client from `schema.prisma` |
| `yarn db:migrate` | Create a dev migration |
| `yarn db:migrate:prod` | Deploy migrations in production |
| `yarn db:studio` | Open Prisma Studio for production DB |
| `yarn clear-commands` | Clear all registered bot commands from Telegram (see below) |

**`src/libs/db.js`** exports `getDb()` — returns a `PrismaClient` instance when `DATABASE_URL` is set, otherwise `null`. Always null-check before use.

## Deployment (CapRover)

The project uses a `captain-definition` file pointing to `./Dockerfile`. Pass all environment variables as CapRover app environment variables. `EXTERNAL_URL` must be set to the public HTTPS URL of the app so the webhook is registered on startup.

Production mode (`NODE_ENV=production`) disables polling and starts an Express server on port 80 that receives Telegram updates via `POST /webhook`.

## Conversation archive

The `/export` command generates a shareable link to a read-only HTML view of a conversation thread.

- **Trigger**: reply to any message in the thread and send `/export` (PM) or `@bot /export` (group)
- **URL format**: `EXTERNAL_URL/archive/{hash}` — the hash is a 128-bit cryptographically random token (`crypto.randomBytes(16)`); security model is "secret link" (the hash is the only credential — no login required)
- **Rendering**: `GET /archive/:hash` resolves the hash to a `threadId` via Redis, loads the thread, and renders `exportHtml` server-side on every request (always reflects current thread state)
- **Expiry**: archive tokens use the same 7-day rolling TTL as all thread keys; expired links return 404
- **Dev mode**: the Express server does not call `app.listen` in development (polling) mode, so archive links are only accessible in production. The `/export` command still generates a valid URL, but it will not resolve locally

## Telegram setup notes

- **Group Privacy Mode must be disabled** via BotFather (`/setprivacy → Disable`) for the bot to receive `@mention` messages in groups
- The bot responds to text messages, image messages (compressed photos and uncompressed image documents), and stickers

## Telegram command list

Telegram stores a server-side list of bot commands (the "/" suggestions shown in clients). This list is set via the Bot API and **does not automatically update** when commands are added or removed from code.

To clear all registered commands after removing them from code:

```sh
TELEGRAM_BOT_TOKEN=<token> yarn clear-commands
# or with .env configured:
yarn clear-commands
```

- **Script**: `scripts/clear-commands.js` — calls `deleteMyCommands` across all scopes (default, private chats, group chats, admins), prints before/after state
- Run this once whenever commands are removed from `src/libs/preprocess.js` to keep the Telegram UI in sync

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

Thread management lives in `src/llm/Thread.js` and is model-agnostic:

- `Thread.create()` — creates a new thread (UUID), initialises Redis entry, returns instance
- `Thread.resolve(messageId)` — looks up which thread owns a Telegram message ID; checks `Thread.messageMap` (static in-memory) first, then Redis; returns a `Thread` instance or `null`
- `thread.append(role, content)` — adds a message to history, trims to 20 entries
- `thread.save()` — persists history to Redis with image blocks stripped (base64 replaced with `"[image]"` to keep payloads small)
- `thread.trackMessage(messageId)` — registers a Telegram message ID in both `Thread.messageMap` and Redis (`msg:{id}` → threadId), enabling bi-directional lookup
- `Thread.messageMap` — static `Map<messageId, threadId>` shared across all instances; warm-path cache to avoid a Redis round-trip on lookups
- All Redis keys use a rolling 7-day TTL (managed by `src/libs/store.js`); without Redis, all state is in-memory and cleared on restart
- In private chats, each top-level message starts a new thread; replying to any tracked message continues that thread — same model as groups
- The system prompt is assembled from ordered `.md` files in `src/llm/` (see below); `LLM_SYSTEM_PROMPT` env var appends extra instructions after them
- Each user message is prefixed with `@username: ` (falling back to first name) so the LLM can distinguish between users in a shared thread

## System prompt files

The default system prompt is assembled in `src/llm/index.js` by loading an ordered list of `.md` files from `src/llm/`:

| File | Purpose |
|---|---|
| `ROLE.md` | Professor Y persona — identity, tone, language rules, immutable constraints |
| `BOT.md` | Telegram-specific guidelines — response length, formatting, multi-user awareness |
| `TOOLS.md` | Custom tool instructions — when and how to call each tool (always loaded) |

**Adding a new prompt file:** create the `.md` file in `src/llm/` and add `loadPrompt("YOURFILE.md")` to the array in `index.js`. Order matters — earlier files take higher precedence.

**Placeholder substitution:** use `%BOT_NAME%` anywhere in a prompt file; it will be replaced at load time with `TELEGRAM_BOT_USERNAME` from the environment.

## Git conventions

- Use **conventional commits** for all commit messages (e.g. `feat:`, `fix:`, `chore:`, `docs:`)
- **Never commit unless explicitly asked** — always wait for the user to say so before running `git commit`
- **Always update CLAUDE.md** after any code change — reflect the intent, behaviour, and any new conventions introduced

## Slash commands (preprocess)

Before a message reaches the LLM, `src/libs/preprocess.js` checks whether it exactly matches a registered slash command. If it does, the command handler runs, the bot replies directly, and `null` is returned to skip LLM processing. Non-command messages pass through unchanged.

**`COMMANDS`** — triggered via `@bot /command` in groups (after `@mention` is stripped) or `/command` directly in private chats:
```js
"/mycommand": ({ llm, bot, msg, chatId }) => "reply string",
```

| Command | Trigger | Response |
|---|---|---|
| `/provider` | Group & PM | Current backend name and model (e.g. `gemini / gemini-2.5-flash`) |
| `/export` | Group & PM | Returns a shareable `EXTERNAL_URL/archive/{hash}` link for the conversation; must be sent as a reply to any message in the thread |
| `/model` | PM only (admin) | Opens an inline keyboard to dynamically switch the active backend and model; admin-only (hardcoded to `yanglin1112`) |

## Dynamic model switching

The active backend and model are selected at runtime via `/model` — no env vars needed. The selection is persisted to Redis with no expiry (`store.set(..., null)`) so it survives restarts.

- **Default (first boot / no Redis):** `claude / claude-haiku-4-5-20251001` (hardcoded in `src/llm/index.js`)
- **`llm.init()`** — called on startup in `main()`; loads the stored `setting:active_model` key and calls `_initBackend(backend, model)`; falls back silently to default if the key is missing or the stored backend has no API key
- **`llm.listModels()`** — instantiates each backend whose API key is set, calls `listModels()` on it, and caches results in `llm._modelListCache` for use by the callback handler; OpenAI returns the 6 most recent chat models (filtered by `gpt-*|o1|o3|o4`, sorted by `created`); Gemini returns all `gemini-*` non-embedding models; Claude returns all `claude-*` models; Lumo returns a hardcoded list
- **`llm.setActiveModel(backend, model)`** — calls `_initBackend()` then persists to Redis
- **Callback flow** — `callback_data` prefixes: `mp:{backend}` (show provider's models), `ms:{backend}:{index}` (select model by cache index), `mb` (back to provider list); index avoids the Telegram 64-byte callback data limit on long model names
- **Admin guard** — `ADMIN_USERNAME = "yanglin1112"` is hardcoded in both `src/libs/preprocess.js` and `index.js`

## Web search

All backends have web search enabled by default — no extra configuration needed.

| Backend | Mechanism |
|---|---|
| Claude | `web_search_20250305` built-in tool; Anthropic executes searches server-side via a standard multi-turn tool loop |
| OpenAI | `web_search_preview` tool via the Responses API; the tool loop is handled server-side automatically |
| Gemini | No built-in web search — Gemini API forbids combining `googleSearch` with `functionDeclarations` in the same request; use `fetch_url` tool instead |
| Lumo | No web search — not available via the Lumo API |

## URL fetching

All backends have the `fetch_url` tool enabled. When the user shares a URL and asks about its contents, the LLM calls this tool to retrieve the page as readable markdown.

- **Implementation**: `src/llm/tools/fetch-url.js` — calls `https://r.jina.ai/{url}` (Jina Reader API), no API key required
- **Output**: clean markdown, truncated to 15,000 characters with `[Content truncated]` if the page is longer
- **Error handling**: network/HTTP errors are returned as a string to the LLM so it can respond gracefully

## Map search

The bot can search for places and POIs via Google Maps using the `search_map` tool.

- **Implementation**: `src/llm/tools/search-map.js` — uses Google Maps Places Text Search API (for `query`) and Geocoding API (for `lat`+`lon` reverse geocoding)
- **Modes**: text search (`query`), geocoding (`query` with an address), reverse geocoding (`lat`+`lon`)
- **Output**: name, address, coordinates, Google Maps link (`place_id` URL), categories (types), rating, price level, open-now status
- **Limit**: configurable via `limit` parameter (1–20); LLM defaults to 5 per `TOOLS.md` guidance
- **Requires**: `GOOGLE_MAPS_API_KEY` env var — needs **Places API** and **Geocoding API** enabled in Google Cloud Console; returns an error string to the LLM if the key is unset

## Meal recommendation

The bot recommends restaurants for breakfast, lunch, or dinner based on the user's location and chosen cuisine genre.

- **Trigger**: Any message expressing meal intent — "what should I eat", "meal recommendation", "I'm hungry", "suggest a restaurant", "recommend me lunch/dinner/breakfast"
- **Meal type detection**: Inferred from current time (breakfast 05:00–10:30, lunch 10:30–17:00, dinner 17:00–05:00); user can always override explicitly
- **Location resolution**: Read from user profile first via `get_user_profile`; if absent, ask the user before proceeding; after the first recommendation, offer to save the location to the profile
- **Genre selection**: LLM suggests 3–4 options based on meal type — breakfast: café, bakery/pastry, brunch, congee, dim sum; lunch: ramen, rice bowl, sushi, Thai, Vietnamese, sandwiches, Indian; dinner: izakaya, Korean BBQ, seafood, Italian, hotpot, steakhouse, tapas — user can also specify their own
- **Implementation**: `src/llm/tools/recommend-meal.js` — calls Google Places Text Search with `limit: 20`, applies Fisher-Yates shuffle in-place, returns the top 3 results formatted with `formatPlaceResult` (re-exported from `search-map.js`)
- **Requires**: `GOOGLE_MAPS_API_KEY` env var (same key as `search_map`); returns an error string to the LLM if unset
- **Tool guidance**: `src/llm/TOOLS.md` contains full LLM orchestration instructions including the genre pool tables and post-recommendation flow

## GitHub source code lookup

The Claude backend can read source files and search code in this repository via the GitHub MCP server, so users can ask precise questions about how the bot is implemented.

- **Trigger**: Any question about the bot's implementation, architecture, a specific feature, or where code is located
- **Tools exposed**: `get_file_contents` (read a file at a given path/branch) and `search_code` (GitHub code search syntax)
- **Flow**: Claude always starts by reading `CLAUDE.md` from the repo to locate the relevant files, then reads the specific source files for precise implementation details
- **Mechanism**: Both Claude and OpenAI execute MCP tools server-side — no custom dispatch needed in the tool loop
  - **Claude**: `client.beta.messages.create()` with `betas: ["mcp-client-2025-11-20"]`; toolset configured via `mcp_servers` + `mcp_toolset` entry in `tools`
  - **OpenAI**: `client.responses.create()` with `{ type: "mcp", server_label, server_url, headers, allowed_tools }` entry in `tools`
- **MCP server**: `https://api.githubcopilot.com/mcp/` (GitHub's hosted Copilot MCP endpoint); allowlisted to `get_file_contents` and `search_code` only
- **Requires**: `GITHUB_TOKEN` env var (GitHub Personal Access Token with read scope)
- **Supported backends**: Claude and OpenAI. Gemini (experimental SDK-only, not wired up) and Lumo (no MCP support) are excluded.
- **Tool guidance**: `src/llm/TOOLS.md` instructs the LLM when and how to call the GitHub tools

## User profiles

Each Telegram user can have a persistent Markdown profile stored in the `user_profiles` database table. The LLM reads and writes it autonomously via two tools.

- **`get_user_profile`** — retrieves profile notes for a user; omit `username` for the current user, or pass a Telegram username to look up another user (e.g. when someone asks about `@alice`); returns `"No profile found for @username."` if none exists
- **`update_user_profile`** — upserts the full Markdown notes document for the current user
- **Implementation**: `src/llm/tools/user-profile.js` — uses `getDb()` from `src/libs/db.js`; both tools are silently omitted when `DATABASE_URL` is unset
- **Keyed by**: Telegram `username` — the only user identity visible to the LLM in the `@username:` message prefix
- **Format**: free-form Markdown bullet points (e.g. `- Language: English`, `- Interests: climbing`)
- **Context flow**: `msg.from.id` + `msg.from.username` are threaded through `llm.chat()` → `backend.complete()` → tool `execute()` as `{ chatId, userId, username }`
- **Tool guidance**: `src/llm/TOOLS.md` instructs the LLM when to call each operation

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
