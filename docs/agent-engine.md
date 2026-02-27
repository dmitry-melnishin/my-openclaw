# Agent Engine — How It Works

## What the agent engine does

Takes a user message, calls the LLM, executes tools if requested, loops until the LLM gives a final text reply, and persists everything to the session transcript. One function call — `runAgent()` — handles the entire cycle.

```typescript
import { runAgent } from "./agent/index.js";

const result = await runAgent({
  sessionKey: "agent:main:channel:cli:account:default:peer:direct:user_123",
  userMessage: "List the files in my workspace",
  config,                    // from loadConfig()
  signal: abortController.signal,  // optional: cancel at any time
  onEvent: (e) => { ... },  // optional: get real-time streaming events
});

console.log(result.reply);       // final assistant text
console.log(result.iterations);  // how many LLM call loops it took
```

## The run loop — step by step

When you call `runAgent()`, here's exactly what happens:

### 1. Setup

```
ensureWorkspace(config)          →  create ~/.myclaw/workspace/ if missing
scaffoldBootstrapFiles(dir)      →  write a starter AGENTS.md if missing
createAgentTools(workspaceDir)   →  Pi SDK coding tools + apply_patch
buildSystemPrompt({ ... })       →  compose from bootstrap files + runtime info
resolveModel(provider, modelId)  →  look up model in Pi SDK registry (or build manually)
```

### 2. Load conversation history

```
loadTranscript(sessionKey)       →  read JSONL file for this session
transcriptToMessages(transcript) →  convert to Pi SDK Message[] format
repairOrphanedToolCalls(msgs)    →  inject synthetic results for any tool calls
                                    that were left hanging by a previous crash
```

Orphan repair is critical — if a prior run was interrupted mid-tool-execution, the transcript will have a `ToolCall` with no matching `ToolResultMessage`. LLM APIs reject this. The repair step injects `[Tool result missing — session was interrupted]` error results so the conversation stays valid.

### 3. The iteration loop

```
for each iteration (up to maxIterations = 25):

  ┌─ Call LLM (with retry/failover) ─────────────────────┐
  │                                                        │
  │  Try current auth profile's API key                    │
  │  ├── Success → merge usage, continue                   │
  │  ├── Context overflow → 3-level recovery (see below)   │
  │  ├── Retriable error → rotate to next profile, retry   │
  │  └── Non-retriable → throw                             │
  │                                                        │
  └────────────────────────────────────────────────────────┘
          │
          ▼
  Extract tool calls from AssistantMessage.content
          │
          ├── No tool calls → persist transcript, return reply
          │
          └── Has tool calls → execute each one:
                  │
                  │  tool.execute(toolCallId, args, signal)
                  │  truncate result to maxToolResultChars (50k)
                  │  append ToolResultMessage to messages
                  │
                  └── loop back to LLM call
```

### 4. Persist and return

After the loop exits (either final reply or max iterations), new messages are appended to the JSONL transcript via `appendMessages()`, and session metadata is updated with the model name and token count.

## Streaming vs. buffered mode

The mode is selected by whether you pass `onEvent`:

```typescript
// Streaming — tokens arrive in real time
const result = await runAgent({
  sessionKey, userMessage, config,
  onEvent: (event) => {
    if (event.type === "llm_stream" && event.event.type === "text_delta") {
      process.stdout.write(event.event.delta);  // live output
    }
  },
});

// Buffered — waits for full response
const result = await runAgent({ sessionKey, userMessage, config });
console.log(result.reply);
```

Under the hood:
- **With `onEvent`**: uses Pi SDK's `streamSimple()` — tokens stream via `for await`
- **Without `onEvent`**: uses Pi SDK's `completeSimple()` — waits for full response

Both return the same `AssistantMessage` with identical usage data.

## Event types

The `onEvent` callback receives `AgentRunEvent` — a union of all lifecycle events:

| Event | When | Useful fields |
|-------|------|---------------|
| `llm_start` | Before each LLM call | `iteration` — which loop iteration |
| `llm_stream` | Each streaming token | `event` — raw Pi SDK `AssistantMessageEvent` (text_delta, thinking_delta, toolcall_end, done, error) |
| `llm_end` | LLM response complete | `message` — full `AssistantMessage` with usage |
| `tool_start` | Before tool execution | `toolName`, `toolCallId` |
| `tool_end` | After tool execution | `toolName`, `durationMs`, `isError` |
| `retry` | Retrying after error | `attempt`, `reason` (auth/rate_limit/...), `profileId` |
| `compaction` | Context was compacted | `oldCount`, `newCount` — message count before/after |
| `done` | Run complete | `result` — the final `RunResult` |

## Auth profile failover

If you have multiple API keys (auth profiles), the engine rotates through them on failure:

```json5
authProfiles: [
  { id: "primary", apiKey: "${KEY_1}" },
  { id: "fallback", apiKey: "${KEY_2}" },
]
```

**How it works:**
1. Start with profile 0 (`primary`)
2. On a retriable error (401, 403, 429, 402, timeout, 5xx), mark the profile as failed and rotate to the next
3. Failed profiles enter a cooldown period — starts at 1s, doubles on each failure (1s → 2s → 4s → ... → 60s max)
4. On success, the profile's cooldown resets to 1s
5. If ALL profiles are cooling down, wait for the shortest cooldown to expire

**Error classification:**

| HTTP Status | Category | Retriable? |
|-------------|----------|------------|
| 401, 403 | `auth` | Yes |
| 429 | `rate_limit` | Yes |
| 402 | `billing` | Yes |
| 5xx | `timeout` | Yes |
| — | `context_overflow` | No (handled by compaction) |
| — | `timeout` (message patterns) | Yes |
| — | `quota` | No |
| — | `unknown` | No |

## 3-level context overflow recovery

When the conversation gets too long for the model's context window, the engine recovers in three escalating levels:

### Level 1: Compact messages via LLM summary

Split messages into old + recent (last 10). Send the old messages to the LLM with "summarize this conversation" and replace them with a single `[Conversation summary]` user message.

```
Before: [user, assistant, tool, user, assistant, ..., user, assistant] (50 messages)
After:  [summary_user_msg, msg_41, msg_42, ..., msg_50] (11 messages)
```

### Level 2: Truncate oversized tool results

If compaction wasn't enough, scan all `ToolResultMessage` entries and truncate any with text content exceeding 20k chars. Appends `[truncated N chars]` marker.

### Level 3: Give up

If the context still overflows after both compaction and truncation, throw an error. This is rare — it means even the recent messages alone exceed the context window.

The flags reset after each successful iteration, so a later iteration can trigger compaction again if needed.

## Tools

The agent has 8 tools — 7 from Pi SDK + 1 custom:

| Tool | Source | What it does |
|------|--------|-------------|
| `read` | Pi SDK | Read file contents (with optional line range) |
| `bash` | Pi SDK | Run shell command, return stdout/stderr |
| `edit` | Pi SDK | Find & replace in a file (`oldText` → `newText`) |
| `write` | Pi SDK | Write or create a file |
| `grep` | Pi SDK | Search file contents by pattern |
| `find` | Pi SDK | Find files by glob pattern |
| `ls` | Pi SDK | List directory contents |
| `apply_patch` | Custom | Apply a unified diff to one or more files |

The `apply_patch` tool uses the `diff` npm package's `parsePatch()` + `applyPatch()` for robust diff handling — supports creating new files, deleting files, and multi-file patches.

Tool results are truncated to `maxToolResultChars` (default: 50k) before being sent back to the LLM.

## System prompt composition

The system prompt is built from five ordered sections:

```
<identity>
You are MyClaw, a helpful AI assistant with access to tools.
...
</identity>

<bootstrap-files>
<file path="AGENTS.md">
... your agent instructions ...
</file>

<file path="SOUL.md">
... persona/tone guidance ...
</file>
</bootstrap-files>

<tools>
You have access to the following tools:
- read
- bash
- edit
...
</tools>

<safety>
- Never fabricate tool results.
- Do not attempt to circumvent permission restrictions.
...
</safety>

<runtime>
- Current time: 2026-02-27T14:00:00.000Z
- Platform: win32 x64
- Working directory: C:\Users\you\.myclaw\workspace
- Model: claude-sonnet-4-20250514
</runtime>
```

### Bootstrap files

Place markdown files in your workspace directory (`~/.myclaw/workspace/`) to customize the agent:

| File | Purpose |
|------|---------|
| `AGENTS.md` | Agent behavior instructions (created automatically with a starter template) |
| `SOUL.md` | Personality and tone guidance |
| `USER.md` | User profile and preferences |
| `TOOLS.md` | Tool usage documentation |
| `IDENTITY.md` | Identity overrides |
| `MEMORY.md` | Long-term knowledge context |
| `HEARTBEAT.md` | Recurring task instructions |
| `BOOTSTRAP.md` | General context |

**Size limits** (prevent system prompt from eating the context window):
- 50k chars per file
- 200k chars total across all files
- Files that don't exist or are empty are silently skipped

## Usage tracking

The `RunResult` has two usage fields:

```typescript
result.usage         // accumulated across ALL LLM calls in this run
result.lastCallUsage // from the LAST LLM call only
```

**Why two?** Cache tokens (cacheRead/cacheWrite) must NOT be summed across calls — each API round-trip reports cache ≈ full context size. Summing them would give wildly inflated numbers. The `lastCallUsage` gives accurate context utilization; `usage` gives accurate input/output token totals.

## Transcript persistence

Messages are stored as JSONL — one line per message. The agent engine:

1. Loads existing transcript on start
2. Converts to Pi SDK `Message[]` format for the LLM
3. Runs the loop, accumulating new messages
4. After the loop, converts new messages back to `TranscriptMessage[]`
5. Appends only the NEW messages (not the full history) via `appendMessages()`

Assistant messages store the full content blocks (including tool calls) in the `meta.contentBlocks` field, so they round-trip correctly when loaded in the next run.

## Model resolution

The engine resolves the model from your config's `provider.name` + `provider.model`:

1. Try Pi SDK's built-in model registry (`getModel("anthropic", "claude-sonnet-4-20250514")`)
2. If found, use it (with `baseUrl` override if specified in config)
3. If not found, construct a manual model with defaults:
   - API format: `anthropic-messages` for Anthropic, `openai-completions` for everything else
   - Context window: 200k tokens
   - Max output: 8192 tokens

This means you can use any model from any provider — known models get accurate metadata (context window, pricing), unknown models get reasonable defaults.

## CLI test script

Test the engine end-to-end:

```bash
node --import tsx scripts/test-agent.ts "What files are in the workspace?"
```

Requires a valid `~/.myclaw/myclaw.json` with at least one auth profile and a `.env` file with your API key. Streams output to stdout, then prints usage stats.

## Configuration knobs

All from the `agent` section of `myclaw.json`:

| Field | Default | What it controls |
|-------|---------|------------------|
| `workspaceDir` | `~/.myclaw/workspace` | Where the agent reads/writes files and looks for bootstrap files |
| `maxIterations` | `25` | Max tool-call loop iterations per message |
| `maxRetries` | `3` | Max retries per LLM call (across auth profiles) |
| `maxToolResultChars` | `50000` | Tool output truncation threshold |

## Source files

| File | Purpose |
|------|---------|
| `src/agent/run.ts` | Main run loop — the orchestrator |
| `src/agent/types.ts` | Shared types and constants |
| `src/agent/streaming.ts` | `resolveModel()`, `streamLLM()`, `callLLM()` wrappers |
| `src/agent/failover.ts` | Error classification + profile rotation with cooldowns |
| `src/agent/context-guard.ts` | 3-level overflow recovery |
| `src/agent/transcript-helpers.ts` | Message conversion + orphan repair |
| `src/agent/bootstrap-files.ts` | Load workspace markdown files with size limits |
| `src/agent/system-prompt.ts` | Compose prompt from bootstrap + runtime |
| `src/agent/workspace.ts` | Ensure workspace dir + scaffold AGENTS.md |
| `src/agent/tools/apply-patch.ts` | Custom unified diff tool |
| `src/agent/tools/create-tools.ts` | Combine Pi SDK tools + apply_patch |
| `src/agent/index.ts` | Barrel exports |
| `scripts/test-agent.ts` | Manual CLI test script |
