# Sessions

## How sessions work in practice

Every conversation produces **two files** in `~/.myclaw/sessions/`:

| File | Format | Purpose |
|------|--------|---------|
| `sessions.json` | JSON | Index of all sessions — one entry per session key with metadata (last seen, model used, token counts, etc.) |
| `<slug>.jsonl` | JSONL | The actual conversation transcript for one session |

So a Telegram DM with user `123456` produces:

```
~/.myclaw/sessions/
  sessions.json
  agent__main__channel__telegram__account__default__peer__direct__user_123456.jsonl
```

The `sessions.json` entry for it:

```json
{
  "agent:main:channel:telegram:account:default:peer:direct:user_123456": {
    "sessionId": "a1b2c3d4-...",
    "updatedAt": 1708000060000,
    "sessionFile": "agent__main__channel__telegram__account__default__peer__direct__user_123456.jsonl",
    "lastChannel": "telegram",
    "chatType": "direct"
  }
}
```

The `.jsonl` transcript for it:

```jsonl
{"type":"session","sessionKey":"agent:main:channel:telegram:account:default:peer:direct:user_123456","createdAt":1708000000000}
{"role":"user","content":"Hello","ts":1708000000000}
{"role":"assistant","content":"Hi! How can I help?","ts":1708000001000}
{"role":"user","content":"What's the weather?","ts":1708000060000}
```

### Why JSONL for transcripts?

Append-only writes — each new message is one `appendFileSync` call to the end of the file. No need to read–parse–rewrite the whole thing on every turn. It's also human-readable and trivially streamable.

### Why a separate `sessions.json` index?

So you can list all sessions, find the newest ones, filter by channel, check token usage, etc. — without opening every `.jsonl` file.

---

## Session key format

```
agent:<agentId>:channel:<channel>:account:<accountId>:peer:<peerKind>:<peerId>
```

Each segment answers a specific routing question:

| Segment | Answers | Example |
|---------|---------|---------|
| `agent:<agentId>` | *Which agent?* Multiple agents can coexist (researcher, coder, assistant) | `agent:main` |
| `channel:<channel>` | *Which platform?* Telegram and Slack are different channels | `channel:telegram` |
| `account:<accountId>` | *Which bot account?* You might run two Telegram bots | `account:default` |
| `peer:<peerKind>:<peerId>` | *Who is talking, in what context?* DM vs. group changes memory scope | `peer:direct:user_123` |

### Why `peerKind` matters

A `direct` conversation (private DM) has its own session history separate from a `group` conversation. The same user sending a DM gets a different memory context than when they're talking in a group chat — which is exactly the right behaviour.

| `peerKind` | When used |
|------------|-----------|
| `direct` | Private DM with a single user |
| `group` | Group chat / supergroup |
| `channel` | Public broadcast channel |

### Now vs. later

With a single bot and Telegram only, segments like `agentId` and `accountId` are always `main` and `default`. But getting the key format right now means adding a second channel (e.g. Slack) or a second agent just produces a different key — no migration, no refactor.

---

## Source files

| File | Responsibility |
|------|---------------|
| `src/sessions/session-key.ts` | Build and parse session keys |
| `src/sessions/transcript.ts` | Append and load JSONL transcripts |
| `src/sessions/store.ts` | Read/write `sessions.json` metadata index |
| `src/sessions/index.ts` | Public API barrel re-export |
