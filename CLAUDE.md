# Professor-Y

A Telegram bot that proxies group messages to an LLM backend and replies with the generated response. Conversation history lives in Redis (or in-memory when Redis is unavailable). A Prisma database layer is wired up for persistent structured data. Current models: `UserProfile` (free-form Markdown notes and preferences per user — notes read/written via LLM tool calls, stealth mode flag managed via `/stealth` command), `Thread` (one row per conversation thread), `Message` (one row per user↔LLM exchange, with content, response, model, and optional attachment metadata).

## How it works

The bot activates in group chats whenever it is **@mentioned** — either in a reply or in a standalone message. In private chats, the bot responds to users with `permissionLevel >= 2` (or level 0 admins); commands (`/start`, `/me`, etc.) run for everyone. Both text and images are supported.

**Forwarded messages are always ignored** — if `msg.forward_origin` is set, the bot silently skips the message regardless of chat type or mention.

**`!noreply` suppresses the LLM** — if the user message contains `!noreply` anywhere, the message is dropped immediately before any processing. No reply is sent. Handled in `index.js`.

**`!info` appends metadata** — if the user message contains `!info` anywhere, the token is stripped before the LLM sees it and the bot appends a `<code>` block to the bottom of its reply with the current model, thread ID, and archive link. Handled in `index.js`.

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

**Conversation history** is per thread. Each new `@mention` starts a fresh thread with a random ID; replies to any message in the thread continue it regardless of who sends them. Multiple users can share a thread — each message is prefixed with `@username:` so the LLM can distinguish speakers.

## Project structure

```
index.js                      ← thin bootstrap: wires services, registers bot event handlers
src/
  bot.js                      ← EnhancedBot: wraps every raw message in IncomingMessage DTO, dispatches commands via onCommand registry, forwards the rest to onMessage handler; passes `request: { family: 4 }` to force IPv4-only DNS for all Telegram API calls
  setup.js                    ← dev (polling) vs production (webhook) setup
  constants/
    commands.js               ← SLASH_COMMANDS, INLINE_COMMANDS, and BOT_COMMANDS (Telegram registration list)
  dto/
    IncomingMessage.js        ← pure DTO: parses raw Telegram msg synchronously, exposes rawContent/isValid/isCommand/inlineCommand() — no async, no DB
  services/
    ThreadService.js          ← per-request service: thread create/load/resolve/resolveOrCreate, appendMessage, save, trackMessages
    BotControlService.js      ← instantiatable service: slash command dispatch + callback_query handling
    LLMService.js             ← instantiatable service: backend routing, chat orchestration
  llm/
    prompts/
      ROLE.md                 ← Professor Y persona and communication rules
      BOT.md                  ← Telegram-specific response guidelines (multi-user, formatting)
      TOOLS.md                ← Custom tool instructions — when and how to call each tool
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
    formatReply.js            ← converts LLM markdown output to Telegram HTML
    attachments.js            ← getLastImage() and toImageBlock() for image support
    formatInfo.js             ← formatInfo(llm, thread, {format}): formats !info metadata block; format "html" (default) or "plain"
    exportHtml.js             ← renders thread history as self-contained HTML (used by GET /archive/:hash)
    redis.js                  ← shared Redis client (null when REDIS_PASSWORD unset)
    store.js                  ← thin wrapper around redis.js: null-guard + TTL, used by ThreadService
    db.js                     ← null-safe Prisma client singleton (null when DATABASE_URL unset)
    subscriber.js             ← Redis Pub/Sub subscriber → bot.sendMessage on notification (no-op when REDIS_PASSWORD unset)
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

| Variable                  | Required    | Default | Description                                                                                                                                                     |
| ------------------------- | ----------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN`      | Yes         | —       | Bot token from BotFather                                                                                                                                        |
| `TELEGRAM_BOT_USERNAME`   | Yes         | —       | Bot username without `@`                                                                                                                                        |
| `OPENAI_API_KEY`          | Optional    | —       | OpenAI API key; enables OpenAI models in `/model`                                                                                                               |
| `ANTHROPIC_API_KEY`       | Optional    | —       | Anthropic API key; enables Claude models in `/model`                                                                                                            |
| `GEMINI_API_KEY`          | Optional    | —       | Google Gemini API key; enables Gemini models in `/model`                                                                                                        |
| `LUMO_API_KEY`            | Optional    | —       | Lumo API key; enables Lumo models in `/model`                                                                                                                   |
| `GOOGLE_MAPS_API_KEY`     | Optional    | —       | Google Maps API key; required for `search_map` tool (Places API + Geocoding API)                                                                                |
| `GITHUB_TOKEN`            | Optional    | —       | GitHub Personal Access Token (read scope); required for GitHub MCP code search tools on the Claude backend                                                      |
| `LLM_SYSTEM_PROMPT`       | No          | —       | Extra instructions appended after the built-in Professor Y system prompt                                                                                        |
| `EXTERNAL_URL`            | Production  | —       | Public URL for webhook registration                                                                                                                             |
| `TELEGRAM_WEBHOOK_SECRET` | Recommended | —       | Secret token registered with Telegram (`openssl rand -hex 32`); verified via `X-Telegram-Bot-Api-Secret-Token` header to reject forged webhook requests         |
| `DATABASE_URL`            | No          | —       | Prisma database URL. SQLite: `file:./prisma/dev.db`. PostgreSQL: `postgresql://user:pass@host:5432/db`. When unset, `getDb()` returns `null` and no DB is used. |
| `NODE_ENV`                | No          | —       | Set to `production` to enable webhook mode                                                                                                                      |
| `PORT`                    | No          | `80`    | Express server port (production only)                                                                                                                           |

## Running locally

```sh
cp .env.example .env   # fill in your tokens
yarn install
yarn prisma generate   # generate Prisma client (re-run after any schema change)
yarn dev               # polling mode, NODE_ENV=development
```

## Database (Prisma)

The project uses **Prisma 6** as its ORM. Two schema files handle the dev/prod split:

| File                       | Provider   | Used by               |
| -------------------------- | ---------- | --------------------- |
| `prisma/schema.prisma`     | PostgreSQL | production (CapRover) |
| `prisma/schema.dev.prisma` | SQLite     | local development     |

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

| Script                 | Action                                                       |
| ---------------------- | ------------------------------------------------------------ |
| `yarn setup:db`        | Auto-setup based on `NODE_ENV` (calls `scripts/setup-db.js`) |
| `yarn dev:db:setup`    | Generate dev client + push SQLite schema                     |
| `yarn dev:db:generate` | Generate Prisma client from `schema.dev.prisma`              |
| `yarn dev:db:push`     | Push schema changes to SQLite (no migration file)            |
| `yarn dev:db:studio`   | Open Prisma Studio for SQLite                                |
| `yarn prod:db:setup`   | Generate prod client + push/migrate PostgreSQL schema        |
| `yarn db:generate`     | Generate Prisma client from `schema.prisma`                  |
| `yarn db:migrate`      | Create a dev migration                                       |
| `yarn db:migrate:prod` | Deploy migrations in production                              |
| `yarn db:studio`       | Open Prisma Studio for production DB                         |
| `yarn clear-commands`  | Clear all registered bot commands from Telegram (see below)  |

**`src/libs/db.js`** exports `getDb()` — returns a `PrismaClient` instance when `DATABASE_URL` is set, otherwise `null`. Always null-check before use.

## Deployment (CapRover)

The project uses a `captain-definition` file pointing to `./Dockerfile`. Pass all environment variables as CapRover app environment variables. `EXTERNAL_URL` must be set to the public HTTPS URL of the app so the webhook is registered on startup.

Production mode (`NODE_ENV=production`) disables polling and starts an Express server on port 80 that receives Telegram updates via `POST /webhook`.

## Conversation archive

The `!info` inline action generates a shareable archive link embedded in the bot's reply.

- **Trigger**: include `!info` anywhere in a message that the bot will process (group: `@bot !info ...` or in a thread reply; PM: `!info ...`)
- **Output**: bot appends a `<code>` block to the bottom of its reply with model name, thread ID, and archive URL
- **URL format**: `EXTERNAL_URL/archive/{threadId}` — the thread ID is itself a 128-bit cryptographically random hex string; security model is "secret link" (the ID is the only credential — no login required)
- **Rendering**: `GET /archive/:hash` calls `new ThreadService(null, { store, db }).load(hash)`, renders `exportHtml` server-side on every request (always reflects current thread state)
- **Expiry**: thread history is now persistent in the DB; Redis TTL only affects in-memory history recency, not archive availability
- **Dev mode**: the Express server does not call `app.listen` in development (polling) mode, so archive links are only accessible in production. The `!info` token still generates a valid URL, but it will not resolve locally

## Telegram setup notes

- **Group Privacy Mode must be disabled** via BotFather (`/setprivacy → Disable`) for the bot to receive `@mention` messages in groups
- The bot responds to text messages, image messages (compressed photos and uncompressed image documents), and stickers

## Telegram command list

Bot commands are registered with Telegram automatically on startup via `setMyCommands`. The list is sourced from `BOT_COMMANDS` in `src/constants/commands.js`. All commands are PM only — registered under `{ type: "all_private_chats" }` scope.

To clear all registered commands manually (e.g. after removing a command from code):

```sh
TELEGRAM_BOT_TOKEN=<token> yarn clear-commands
# or with .env configured:
yarn clear-commands
```

- **Script**: `scripts/clear-commands.js` — calls `deleteMyCommands` across all scopes (default, private chats, group chats, admins), prints before/after state
- Adding a new command: add its handler to `_commands()` in `src/services/BotControlService.js` and register it in `BOT_COMMANDS` in `src/constants/commands.js`

## Adding a new LLM backend

1. Create `src/llm/backends/<name>.js` — implement a class with a single `async complete(messages)` method that accepts an OpenAI-style messages array (`[{ role, content }]`) and returns a string
   - `content` may be a plain string (text-only) or an array of blocks (multimodal). Image blocks use the neutral format `{ type: "image", mediaType, data }` — implement a `normalizeMessages()` method to translate these to your backend's format before the API call
   - If the backend uses a different system prompt format (like Anthropic), extract the `role: 'system'` entry from the array and handle it internally
2. Register the backend in `src/services/LLMService.js`:
   ```js
   const BACKENDS = {
     openai: () => require("./backends/openai"),
     claude: () => require("./backends/claude"),
     yourbackend: () => require("./backends/yourbackend"), // add here
   };
   ```
3. Add the relevant env vars to `.env.example` and `Dockerfile`
4. Set `LLM_BACKEND=yourbackend` in `.env`

## Conversation threads

Each bot interaction in a group starts a **new thread** with its own isolated conversation history. Replies to any message in the thread (bot or user) continue the same thread without requiring another `@mention`.

Thread management lives in `src/services/ThreadService.js`. A new `ThreadService` instance is created per incoming message with an `IncomingMessage` DTO:

- `new ThreadService(incoming, { store, db })` — per-request instance; `incoming` provides routing context; `store`/`db` are injected for testability; owns the DB fetch for user info via `_fetchUserInfo(userId)`
- `threadService.resolveOrCreate()` — full routing logic: group (resolve by reply → create on @mention → null) or private (permission gate → resolve or create); calls `_fetchUserInfo(userId)` for `stealth`/`permissionLevel`; sets `threadService.thread`; returns `{ userMessage }` on success, `null` to ignore, or `{ reject, reason }` to deny
- `threadService.appendMessage(cleanContent, prefixedContent, { userId, attachment })` — appends user message to history and writes a DB record before the LLM call
- `threadService.save({ replyModel })` — persists history to Redis (images stripped) and updates the pending DB row with the LLM response; called by index.js after the reply is sent
- `threadService.trackMessages(...messageIds)` — maps Telegram message IDs to this thread in Redis for future lookups; no in-memory cache (Redis is the single source of truth)
- `thread.append(role, content)` — pure method on the Thread data class; adds a message to history, trims to 20 entries; called by `LLMService.chat()` for the assistant reply
- `thread.toPublicUrl()` — returns the public archive URL (`EXTERNAL_URL/archive/{thread.id}`)
- `thread.stealth` — boolean set at construction time from `_fetchUserInfo`; when `true`, all DB writes are suppressed (Redis-only); `Thread` holds only `id`, `history`, and `stealth` — no service-set mutable state
- All Redis keys use a rolling 7-day TTL (managed by `src/libs/store.js`); thread continuation requires Redis — without it, `resolve()` always returns null
- The system prompt is assembled from ordered `.md` files in `src/llm/prompts/` (see below); `LLM_SYSTEM_PROMPT` env var appends extra instructions after them
- Each user message is prefixed with `@username: ` (falling back to first name) so the LLM can distinguish between users in a shared thread

## System prompt files

The default system prompt is assembled in `src/services/LLMService.js` by loading an ordered list of `.md` files from `src/llm/prompts/`:

| File       | Purpose                                                                          |
| ---------- | -------------------------------------------------------------------------------- |
| `ROLE.md`  | Professor Y persona — identity, tone, language rules, immutable constraints      |
| `BOT.md`   | Telegram-specific guidelines — response length, formatting, multi-user awareness |
| `TOOLS.md` | Custom tool instructions — when and how to call each tool (always loaded)        |

**Adding a new prompt file:** create the `.md` file in `src/llm/prompts/` and add `loadPrompt("YOURFILE.md")` to the `DEFAULT_SYSTEM_PROMPT` array in `src/services/LLMService.js`. Order matters — earlier files take higher precedence.

**Placeholder substitution:** use `%BOT_NAME%` anywhere in a prompt file; it will be replaced at load time with `TELEGRAM_BOT_USERNAME` from the environment.

## Git conventions

- Use **conventional commits** for all commit messages (e.g. `feat:`, `fix:`, `chore:`, `docs:`)
- **Never commit unless explicitly asked** — always wait for the user to say so before running `git commit`
- **Always update CLAUDE.md** after any code change — reflect the intent, behaviour, and any new conventions introduced

## Actions

**Actions** are the mechanisms by which users control bot behaviour outside of normal LLM conversation. There are four types:

| Type               | Trigger           | Scope      | Description                                                                                                                                                                                                |
| ------------------ | ----------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Command action** | `/command` prefix | Group & PM | Standard Telegram bot commands detected via `msg.entities` in `IncomingMessage._parseCommand()`; dispatched by `EnhancedBot` before thread/mention routing. In groups, `/command@botname` form is required to avoid collisions with other bots. |
| **Inline action**  | `!` prefix        | Group & PM | Tokens embedded anywhere in a message that trigger specific behaviour. Detected and processed in `index.js`.                                                                                               |
| **Menu action**    | Reply keyboard    | PM only    | Interactions driven by Telegram reply keyboards (the keyboard that replaces the text input). Must never be shown or accepted in group chats.                                                               |
| **Choice action**  | Inline keyboard   | PM only    | Interactions driven by Telegram inline keyboards (buttons attached to a message, handled via `callback_query`). Must never be shown or accepted in group chats.                                            |

**Command actions (all PM only):**

| Command              | Description                                                                             |
| -------------------- | --------------------------------------------------------------------------------------- |
| `/start`             | Creates the user's profile row in DB — the only way a profile can be created            |
| `/model`             | Shows current AI model; admin can switch provider and model via inline keyboard         |
| `/me`                | Fetches and displays the user's saved profile notes directly from DB; no LLM involved   |
| `/forget`            | Clears the user's profile notes field (keeps the DB row); no LLM involved               |
| `/stealth [on\|off]` | Toggle stealth mode — when on, messages are not stored to DB; requires profile to exist |

**Inline actions:**

| Token      | Effect                                                                           |
| ---------- | -------------------------------------------------------------------------------- |
| `!noreply` | Suppresses the LLM — no reply is sent                                            |
| `!info`    | Appends model name, thread ID, and archive link to the bottom of the bot's reply |

**Menu actions:** none currently.

**Choice actions:**

| `callback_data`        | Flow                  | Effect                                                                       |
| ---------------------- | --------------------- | ---------------------------------------------------------------------------- |
| `up_e:{userId}`        | `/start` notification | Promote user to level 2; any level-0 admin can act; edits message to confirm |
| `up_i:{userId}`        | `/start` notification | Ignore — user stays at level 1; edits message to confirm                     |
| `mp:{backend}`         | `/model`              | Show model list for the chosen provider                                      |
| `ms:{backend}:{index}` | `/model`              | Select model by index in the cached list                                     |
| `mb`                   | `/model`              | Back to provider list                                                        |

`up_e:`/`up_i:` are handled before the model-switching guard — they call `_isAdmin(from.id)` (`permissionLevel === 0` in DB) so any admin can act. The `/model` callbacks use the same `_isAdmin` check.

## Keyword filters

Keyword filters are a separate concept from actions. They are hardcoded string patterns checked before any action handling — if a message matches, the pipeline stops immediately with no reply and no handler runs.

| Keyword  | Effect                                               |
| -------- | ---------------------------------------------------- |
| `白爛+1` | Message silently dropped; pipeline stops immediately |

## Bot commands (BotControlService)

`IncomingMessage._parseCommand()` detects bot commands via `msg.entities` (entity type `bot_command` at offset 0) and exposes `incoming.isCommand` and `incoming.command`. `EnhancedBot` handles dispatch: when `incoming.isCommand` is true it calls the matching handler registered via `bot.onCommand()`; if none matches, the message falls through to `handleMessage`. All `SLASH_COMMANDS` are registered to `botControl.handleCommand` at startup in `index.js`.

Command dispatch and all slash command handlers live in `src/services/BotControlService.js`. All commands are PM-only — `handleCommand` silently returns `false` for group messages. `BotControlService` also exposes `_isAdmin(userId)` (DB `permissionLevel === 0` check) and `_guard(incoming)` (userId + DB availability check) used by command handlers.

Adding a new command: add the key to `SLASH_COMMANDS` in `src/constants/commands.js` (auto-registered at startup), add a `{ command, description }` entry to `BOT_COMMANDS` (Telegram display), and add its handler to `_commands()` in `BotControlService`.

**Handler signature:**

```js
[SLASH_COMMANDS.MYCOMMAND]: async (incoming) => "reply string" | null,
```

Return a string to send as a reply, or `null` to handle sending inside the handler.

| Command              | Response                                                                                       |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| `/start`             | Creates a new profile row (`id`, `username`); if already exists, confirms and points to `/me`  |
| `/model`             | Shows current AI model; admin can switch provider and model via inline keyboard                |
| `/me`                | Shows the user's profile notes from DB, or a "no record" message if none exists                |
| `/forget`            | Clears the user's profile notes field (row kept); confirms success or reports nothing to clear |
| `/stealth [on\|off]` | Toggle stealth mode; returns "run /start first" if no profile exists                           |

## Dynamic model switching

The active backend and model are selected at runtime via `/model` — no env vars needed. The selection is persisted to Redis with no expiry (`store.set(..., null)`) so it survives restarts.

- **Default (first boot / no Redis):** `claude / claude-haiku-4-5-20251001` (hardcoded in `src/services/LLMService.js`)
- **`llm.init()`** — called on startup in `main()`; loads the stored `setting:active_model` key and calls `_initBackend(backend, model)`; falls back silently to default if the key is missing or the stored backend has no API key
- **`llm.listModels()`** — instantiates each backend whose API key is set, calls `listModels()` on it, and caches results internally; OpenAI returns the 6 most recent chat models (filtered by `gpt-*|o1|o3|o4`, sorted by `created`); Gemini returns all `gemini-*` non-embedding models; Claude returns all `claude-*` models; Lumo returns a hardcoded list. Read the cache via `llm.availableBackends()`, `llm.models(backendName)`, `llm.modelAt(backendName, index)`
- **`llm.setActiveModel(backend, model)`** — calls `_initBackend()` then persists to Redis
- **Callback flow** — `callback_data` prefixes: `mp:{backend}` (show provider's models), `ms:{backend}:{index}` (select model by cache index), `mb` (back to provider list); index avoids the Telegram 64-byte callback data limit on long model names
- **Admin guard** — `permissionLevel === 0` in the DB; checked via `BotControlService._isAdmin(userId)` for both `/model` and callback queries

## Web search

All backends have web search enabled by default — no extra configuration needed.

| Backend | Mechanism                                                                                                                                          |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude  | `web_search_20250305` built-in tool; Anthropic executes searches server-side via a standard multi-turn tool loop                                   |
| OpenAI  | `web_search_preview` tool via the Responses API; the tool loop is handled server-side automatically                                                |
| Gemini  | No built-in web search — Gemini API forbids combining `googleSearch` with `functionDeclarations` in the same request; use `fetch_url` tool instead |
| Lumo    | No web search — not available via the Lumo API                                                                                                     |

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
- **Tool guidance**: `src/llm/prompts/TOOLS.md` contains full LLM orchestration instructions including the genre pool tables and post-recommendation flow

## GitHub source code lookup and write access

The Claude and OpenAI backends can read source files, search code, and create branches/files/PRs in this repository via the GitHub MCP server.

- **Trigger**: Any question about the bot's implementation, architecture, a specific feature, or where code is located; also any request to create a branch, commit a file, or open a PR
- **Tools exposed**:
  - `get_file_contents` — read a file at a given path/branch
  - `search_code` — GitHub code search syntax
  - `create_branch` — create a new branch
  - `create_or_update_file` — commit a file to a branch
  - `create_pull_request` — open a PR
- **Flow**: Claude always starts by reading `CLAUDE.md` from the repo to locate the relevant files, then reads the specific source files for precise implementation details
- **Mechanism**: Both Claude and OpenAI execute MCP tools server-side — no custom dispatch needed in the tool loop
  - **Claude**: `client.beta.messages.create()` with `betas: ["mcp-client-2025-11-20"]`; toolset configured via `mcp_servers` + `mcp_toolset` entry in `tools`
  - **OpenAI**: `client.responses.create()` with `{ type: "mcp", server_label, server_url, headers, allowed_tools }` entry in `tools`
- **MCP server**: `https://api.githubcopilot.com/mcp/` (GitHub's hosted Copilot MCP endpoint); allowlisted to the five tools above
- **Requires**: `GITHUB_TOKEN` env var — a GitHub Personal Access Token (classic, `repo` scope) belonging to a bot account with Write collaborator access to the repo
- **Supported backends**: Claude and OpenAI. Gemini (experimental SDK-only, not wired up) and Lumo (no MCP support) are excluded.
- **Tool guidance**: `src/llm/prompts/TOOLS.md` instructs the LLM when and how to call the GitHub tools

## User profiles

Each Telegram user can have a persistent Markdown profile stored in the `user_profiles` database table. The LLM reads and writes it autonomously via two tools.

- **`get_user_profile`** — retrieves profile notes for a user; omit `username` for the current user (looked up by `id`), or pass a Telegram username to look up another user (e.g. when someone asks about `@alice`); returns `"No profile found for @username."` if none exists
- **`update_user_profile`** — updates the current user's Markdown notes; no `username` parameter (cross-user writes removed); returns a "run /start first" message if no profile exists
- **Implementation**: `src/llm/tools/user-profile.js` — uses `getDb()` from `src/libs/db.js`; both tools are silently omitted when `DATABASE_URL` is unset
- **Keyed by**: Telegram `userId` stored as `id String @id` — the primary key, stable across username changes; `username` is stored as a nullable side-channel field set at `/start` time and used for cross-user read lookups only
- **Profile creation**: exclusively via `/start` command — no lazy upserts anywhere; all write operations that require a profile return a "run /start first" message if none exists
- **Permission levels**: `permissionLevel Int @default(1)` — 0 = admin (manual DB seed), 1 = new user (no PM chat access), 2 = promoted user (full PM access); admins are notified on `/start` and can promote via inline keyboard
- **Format**: free-form Markdown bullet points (e.g. `- Language: English`, `- Interests: climbing`)
- **Context flow**: `IncomingMessage` exposes `chatId`, `userId`, `username` — passed directly as the `incoming` argument to `llm.chat(thread, incoming)` → `backend.complete(messages, { chatId, userId, username })` → tool `execute()`
- **Tool guidance**: `src/llm/prompts/TOOLS.md` instructs the LLM when to call each operation

## Stealth mode

Users can opt out of DB storage on a per-user basis via `/stealth [on|off]`. Requires a profile to exist (run `/start` first); returns an error if none is found. The `stealthMode` flag is stored as a column on the existing `user_profiles` table (keyed by `id`). The `/stealth` command handler in `BotControlService` writes it directly via the injected `db`.

For each incoming message, `ThreadService._fetchUserInfo(userId)` fetches `stealthMode` and `permissionLevel` from the DB in a single query at the start of `resolveOrCreate()` — `index.js` never touches these values directly. `IncomingMessage` is a pure synchronous DTO with no DB dependency. `thread.stealth` is set at Thread construction time from the `_fetchUserInfo` result; mid-conversation stealth toggles take effect on the next message. Redis is unaffected — only DB writes are suppressed.

## Image support

Images are plumbed from Telegram through to the LLM via a neutral internal format, then translated per-backend before the API call.

**Trigger conditions (groups):** photo or sticker attached to an `@mention` message, or a reply (with or without `@mention`) to a message that contains a photo or sticker. In private chats, any message with a photo or sticker is handled.

**Pipeline:**

1. `getLastImage(msg)` (`src/libs/attachments.js`) — extracts the largest photo size, image document, or sticker thumbnail from a Telegram message
2. `targetAttachment = msgAttachment || replyAttachment` — current message photo takes priority over the replied-to message photo
3. `toImageBlock(file)` (`src/libs/attachments.js`) — calls the Telegram API directly (no SDK) to resolve `file_id` → `file_path`, downloads the file, base64-encodes it, and returns a neutral block: `{ type: "image", mediaType, data }`; reads `TELEGRAM_BOT_TOKEN` from env
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
