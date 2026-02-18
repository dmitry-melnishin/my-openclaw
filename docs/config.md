# Config Layer — How It Works

## What the config file is

A single JSON5 file at `~/.myclaw/myclaw.json` that controls **everything** about your assistant — which LLM to use, how to connect to Telegram, server settings, etc. You edit it once, and all systems read from it.

## What it contains

```json5
// ~/.myclaw/myclaw.json
{
  // 1. Which LLM to talk to + API keys (with failover)
  provider: {
    name: "anthropic",                    // or "openai", "google", etc.
    model: "claude-sonnet-4-20250514",    // the model you want
    authProfiles: [
      { id: "primary", apiKey: "${ANTHROPIC_API_KEY}" },    // reads from env var
      { id: "fallback", apiKey: "${ANTHROPIC_API_KEY_2}" }, // backup if primary hits rate limit
    ],
  },

  // 2. Channel connections (Telegram for now, more later)
  channels: {
    telegram: {
      botToken: "${TELEGRAM_BOT_TOKEN}",         // your bot's token
      allowedChatIds: ["123456", "789012"],       // optional: restrict which chats can use the bot
    },
  },

  // 3. Gateway server settings
  gateway: {
    port: 18789,                          // HTTP/WS port
    token: "${GATEWAY_TOKEN}",            // shared secret for API auth
  },

  // 4. Agent behavior
  agent: {
    workspaceDir: "~/.myclaw/workspace",  // where the agent reads/writes files
    maxIterations: 25,                    // max tool-call loops per message
    maxRetries: 3,                        // retries on LLM errors before giving up
  },

  // 5. Logging
  logging: {
    level: "info",                        // "debug" | "info" | "warn" | "error"
    redactSensitive: true,                // hide API keys in logs
  },
}
```

## How it works at runtime

1. **You set env vars** (in `.env` or your shell) — `ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN`, etc.
2. **You run the gateway** — it calls `loadConfig()` which:
   - Reads `~/.myclaw/myclaw.json` as JSON5 (supports comments, trailing commas)
   - Substitutes `${ANTHROPIC_API_KEY}` → actual key from env
   - Validates the whole thing against Zod schemas (rejects typos/unknown keys immediately)
   - Applies defaults (port 18789, 25 iterations, etc. for anything you didn't specify)
   - Caches for 200ms so repeated reads in the same request don't re-parse
3. **All systems read from the same typed object** — the Telegram adapter reads `config.channels.telegram.botToken`, the agent engine reads `config.provider.model`, failover reads `config.provider.authProfiles`, etc.

## What it does NOT contain

- **Chat history** — stored separately as JSONL files per session (Sprint 1.2)
- **Memory/knowledge** — stored in workspace files like `MEMORY.md` (Sprint 1.9)
- **User's chat name or display name** — that comes from the Telegram message itself at runtime, not from config

## First-time setup

If no config exists, `scaffoldConfigIfMissing()` creates a starter template at `~/.myclaw/myclaw.json` with commented-out sections so you know what's available.

## Key design decisions

| Decision | Why |
|----------|-----|
| **JSON5, not YAML** | Allows comments to explain fields, trailing commas, but still JSON-compatible |
| **`${VAR}` env substitution** | API keys stay in env vars, not committed to files |
| **Auth profiles array** | When your primary key is rate-limited, the agent auto-rotates to the fallback (Sprint 1.3 implements the rotation logic) |
| **Strict Zod schemas** | A typo like `provder` fails immediately with a clear error instead of silently being ignored |
| **Defaults filled in** | Minimal config (just provider + one key) is enough to start — everything else has sensible defaults |

## Env var overrides

| Variable | What it overrides |
|----------|-------------------|
| `MYCLAW_STATE_DIR` | State directory (default: `~/.myclaw`) |
| `MYCLAW_CONFIG_PATH` | Config file path (default: `~/.myclaw/myclaw.json`) |
| `MYCLAW_GATEWAY_PORT` | Gateway port (default: `18789`) |
| `MYCLAW_HOME` | Home directory for `~` expansion |

## Source files

| File | Purpose |
|------|---------|
| `src/config/schema.ts` | Zod strict schemas for the config shape |
| `src/config/loader.ts` | `loadConfig()` pipeline + `scaffoldConfigIfMissing()` |
| `src/config/paths.ts` | Directory/file resolution with env overrides |
| `src/config/defaults.ts` | Immutable defaults chain |
| `src/config/env-substitution.ts` | `${VAR}` substitution engine |
| `src/config/index.ts` | Barrel re-export |
