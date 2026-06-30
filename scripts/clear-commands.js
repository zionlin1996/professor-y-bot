#!/usr/bin/env node
/**
 * Clears all registered bot commands from Telegram.
 *
 * Telegram stores the command list server-side (shown as "/" suggestions in clients).
 * Removing commands from code does NOT remove them from Telegram — this script does.
 *
 * Usage:
 *   TELEGRAM_BOT_TOKEN=<token> node scripts/clear-commands.js
 *   # or with .env configured:
 *   node scripts/clear-commands.js
 */

require('dotenv').config()

const token = process.env.TELEGRAM_BOT_TOKEN
if (!token) {
  console.error('Error: TELEGRAM_BOT_TOKEN is not set.')
  process.exit(1)
}

async function main () {
  const base = `https://api.telegram.org/bot${token}`

  // 1. Show what's currently registered
  const getRes = await fetch(`${base}/getMyCommands`)
  const getCurrent = await getRes.json()
  console.log('Current commands:', JSON.stringify(getCurrent.result, null, 2))

  // 2. Delete all scopes
  const scopes = [
    { scope: { type: 'default' } },
    { scope: { type: 'all_private_chats' } },
    { scope: { type: 'all_group_chats' } },
    { scope: { type: 'all_chat_administrators' } }
  ]

  for (const payload of scopes) {
    const res = await fetch(`${base}/deleteMyCommands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    const json = await res.json()
    console.log(`deleteMyCommands (${payload.scope.type}):`, json.ok ? 'ok' : json)
  }

  // 3. Confirm cleared
  const confirmRes = await fetch(`${base}/getMyCommands`)
  const confirmJson = await confirmRes.json()
  console.log('Commands after clearing:', JSON.stringify(confirmJson.result, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
