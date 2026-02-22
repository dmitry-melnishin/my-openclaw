# Agent Engine

## How the agent works in practice

The agent engine is the core of MyClaw — it receives a user message, calls an LLM, executes tool calls in a loop, and returns a reply. It uses the [Pi SDK](https://www.npmjs.com/package/@mariozechner/pi-ai) for multi-provider LLM calls and streaming, and [Pi Coding Agent](https://www.npmjs.com/package/@mariozechner/pi-coding-agent) for ready-made coding tools.

## Directory layout

When `runAgent()` is called, it creates the workspace directory (default: `~/.myclaw/workspace/`) if it doesn't exist and seeds it with a starter `AGENTS.md`:

```
~/.myclaw/
├── myclaw.json          # Config file (user-managed)
├── workspace/           # Agent's working directory (auto-created)
│   └── AGENTS.md        # Default agent instructions (auto-created, never overwritten)
├── sessions/            # Conversation transcripts (auto-created)
│   └── *.jsonl          # One file per session
└── logs/                # Log files (future use)
```

The workspace path is configurable via `agent.workspaceDir` in `myclaw.json`:

```json5
{ agent: { workspaceDir: "~/my-project" } }
```

This makes the agent operate directly on your project files instead of the default sandbox.

## Bootstrap files

The workspace can contain optional Markdown files that customise the agent's behaviour. All found files are injected into the system prompt as `<file path="AGENTS.md">...</file>` blocks.

| File | Purpose |
|------|---------|
| `AGENTS.md` | Agent behavior instructions (auto-created with defaults) |
| `SOUL.md` | Persona and tone |
| `USER.md` | User profile / preferences |
| `TOOLS.md` | Tool usage guidance |
| `IDENTITY.md` | Identity overrides |
| `HEARTBEAT.md` | Proactive task list |
| `MEMORY.md` | Long-term knowledge |
| `BOOTSTRAP.md` | General context |

## Tools

All tools are scoped to the workspace directory. Pi SDK provides 4 coding tools via `createCodingTools(workspace)`, plus one custom tool:

| Tool | Source | Schema | What it does |
|------|--------|--------|--------------|
| `bash` | Pi SDK | `{ command }` | Run shell command, return stdout/stderr |
| `read` | Pi SDK | `{ path, offset?, limit? }` | Read file contents with optional line range |
| `write` | Pi SDK | `{ path, content }` | Write/create file |
| `edit` | Pi SDK | `{ path, oldText, newText }` | Partial file editing (find & replace) |
| `apply_patch` | Custom | `{ patch }` | Apply unified diff — multi-file edits in one call |

> **Note:** Pi SDK tool names are `read`, `write`, `edit`, `bash` — not `read_file`, `write_file`, etc. Parameters also differ: `read` uses `offset`/`limit` (1-based line number); `edit` uses `oldText`/`newText`.

## Request flow

```
User message
    │
    ▼
runAgent({ sessionKey, userMessage, config, onEvent? })
    │
    ├─ ensureWorkspace()      → creates ~/.myclaw/workspace/ + AGENTS.md
    ├─ createTools(workspace) → Pi SDK read/write/edit/bash + apply_patch
    ├─ buildSystemPrompt()    → identity + bootstrap files + tool docs + runtime info
    ├─ loadTranscript()       → loads past messages from ~/.myclaw/sessions/*.jsonl
    │
    ▼
  ┌─── Agent loop (max 25 iterations) ───┐
  │                                       │
  │  Call LLM (streamLLM or callLLM)      │
  │     ↓                                 │
  │  Tool calls? ──No──→ Return reply     │
  │     │ Yes                             │
  │     ↓                                 │
  │  Execute each tool in workspace       │
  │  (read files, edit code, run bash)    │
  │     ↓                                 │
  │  Append tool results → loop back      │
  └───────────────────────────────────────┘
    │
    ├─ On error: retry + rotate auth profiles
    ├─ On context overflow: compact old messages into summary
    │
    ▼
  Return { reply, usage, iterations }
  + persist messages to session transcript
```

## Streaming

The agent supports two modes, controlled by the `onEvent` parameter:

| Mode | How | When |
|------|-----|------|
| **Streaming** | `streamLLM()` → Pi SDK `streamSimple()` | `onEvent` callback provided |
| **Buffered** | `callLLM()` → Pi SDK `completeSimple()` | `onEvent` omitted |

Both return the same `AssistantMessage` type. In streaming mode, Pi SDK emits `AssistantMessageEvent`s:

| Event | Purpose |
|-------|---------|
| `text_delta` | Incremental text token |
| `thinking_delta` | Thinking/reasoning token (debug) |
| `toolcall_start` / `toolcall_end` | Tool call lifecycle |
| `done` | Final message with usage stats |
| `error` | Stream error |

In CLI mode, set `MYCLAW_NO_STREAM=1` to disable streaming.

## Error recovery

### Auth profile failover

When an LLM call fails with an auth, rate-limit, or billing error, the agent rotates to the next auth profile in `config.provider.authProfiles[]` and retries (up to `maxRetries`, default 3).

### Context overflow

When the context window is exceeded, the agent auto-compacts: it summarises old messages into a single `UserMessage` with a `[Previous conversation summary]:` prefix, keeps the most recent 10 messages intact, and retries the call.

> Pi SDK's `Message` union has no `system` role — compaction summaries use `UserMessage` with a prefix instead.

## System prompt composition

The system prompt is built from 4 sections:

1. **Identity** — default or custom identity text
2. **Bootstrap files** — all found `.md` files from the workspace (see table above)
3. **Tool instructions** — auto-generated from the tool registry (name + description + guidelines)
4. **Runtime context** — OS, CWD (workspace path), date/time, Node version, shell

## Entry points

```typescript
import { runAgent } from './agent/index.js';
import type { RunAgentParams, RunResult, StreamCallback } from './agent/index.js';

const result = await runAgent({
  sessionKey,
  userMessage: "Hello!",
  config,
  onEvent: (event) => {
    if (event.type === "text_delta") process.stdout.write(event.delta);
  },
});

console.log(result.reply);       // final text
console.log(result.usage);       // { input, output, totalTokens, cost }
console.log(result.iterations);  // number of loop iterations
```

## Pi SDK packages

| Package | Version | Purpose |
|---------|---------|---------|
| `@mariozechner/pi-ai` | 0.54.0 | `streamSimple()`, `completeSimple()`, `getModels()`, `Message` types, `Usage`, `Type` (TypeBox re-export) |
| `@mariozechner/pi-agent-core` | 0.54.0 | `AgentTool` interface, `AgentToolResult`, `agentLoop()` |
| `@mariozechner/pi-coding-agent` | 0.54.0 | `createCodingTools(cwd)` → read, write, edit, bash tools |
| `@sinclair/typebox` | 0.34.48 | TypeBox schemas for tool parameters (transitive dep) |
