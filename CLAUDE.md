# Professor-Y

A Telegram bot that proxies group messages to an LLM backend and replies with the generated response. No database — purely stateless per process (conversation history lives in memory).

## How it works

The bot activates in group chats whenever it is **@mentioned** — either in a reply or in a standalone message. In private chats, the bot responds to all messages.

**Group trigger — mention inside a reply:**
1. User replies to any message and includes `@botname` in the reply text
2. Bot receives: `> [original message]\n\n[reply text without @mention]`
3. If the reply text is empty (just `@botname`), only the original message is sent as the prompt
4. LLM response is formatted to Telegram HTML and sent as a reply

**Group trigger — direct mention (no reply):**
1. User sends a message that includes `@botname` (not as a reply)
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
    backends/
      openai.js               ← OpenAI backend
      claude.js               ← Anthropic Claude backend
  libs/
    parseMessage.js           ← extracts chatId, userId, text from Telegram msg
    formatReply.js            ← converts LLM markdown output to Telegram HTML
Dockerfile                    ← production image (node:20.18.1-alpine, port 80)
captain-definition            ← CapRover deployment config
.env.example                  ← all supported environment variables
```

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Yes | — | Bot token from BotFather |
| `TELEGRAM_BOT_USERNAME` | Yes | — | Bot username without `@` |
| `LLM_BACKEND` | No | `openai` | `openai` or `claude` |
| `OPENAI_API_KEY` | If openai | — | OpenAI API key |
| `OPENAI_MODEL` | No | `gpt-4o-mini` | OpenAI model name |
| `ANTHROPIC_API_KEY` | If claude | — | Anthropic API key |
| `CLAUDE_MODEL` | No | `claude-haiku-4-5-20251001` | Claude model name |
| `LLM_SYSTEM_PROMPT` | No | — | System prompt injected into every request |
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
- The bot only responds to text messages (`msg.text` must exist)

## Adding a new LLM backend

1. Create `src/llm/backends/<name>.js` — implement a class with a single `async complete(messages)` method that accepts an OpenAI-style messages array (`[{ role, content }]`) and returns a string
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

## Conversation history

- Stored in-memory as a `Map` keyed by `chatId:userId`
- Capped at 20 messages per conversation (oldest trimmed first)
- Cleared on process restart
- System prompt (`LLM_SYSTEM_PROMPT`) is prepended to every request but not stored in history

## Response formatting

LLM output (standard Markdown) is converted to Telegram-compatible HTML via `src/libs/formatReply.js`:
- Uses `marked` to render standard Markdown → HTML
- Post-processes to replace unsupported tags (`<strong>→<b>`, `<em>→<i>`, `<h1-6>→<b>`, `<li>→•`, etc.)
- Strips any remaining tags not supported by Telegram
- Falls back to plain text if Telegram rejects the HTML
