# MyClaw — Copilot Instructions

Personal AI assistant: multi-channel gateway with LLM agent engine.

**Reference implementation:** The real OpenClaw codebase lives at `../openclaw`. When you need to understand how a pattern works, how a module is structured, or how a problem was solved in practice — read the corresponding files there.

## Tech Stack & Runtime

- **Node 22+**, ESM-only (`"type": "module"` in package.json)
- **Strict TypeScript** — target `es2023`, `moduleResolution: NodeNext`
  - All imports must use explicit `.ts` extensions (e.g., `import { foo } from './bar.ts'`); `allowImportingTsExtensions` is enabled
- **pnpm** — the only supported package manager
- **Config:** JSON5 files validated with **Zod** schemas
- **Build:** `tsdown` (outputs to `dist/`)
- **Test:** Vitest
- **Dev runner:** `tsx` (via `node --import tsx`)

## Commands

| Task | Command |
|---|---|
| Install | `pnpm install` |
| Dev | `pnpm dev` |
| Build | `pnpm build` |
| Test (single run) | `pnpm test` |
| Test (watch) | `pnpm test:watch` |
| Type-check | `pnpm typecheck` |
| CLI agent test | `node --import tsx scripts/test-agent.ts "message"` |
| CLI agent REPL | `node --import tsx scripts/test-agent.ts` |

## Project Structure

```
src/
├── config/                    — Config layer (Sprint 1.1 ✅)
│   ├── schema.ts              — Zod strict schemas (MyClawConfig, AuthProfile, Provider, etc.)
│   ├── loader.ts              — loadConfig(): JSON5 → env sub → Zod validate → defaults → 200ms cache
│   ├── paths.ts               — ~/.myclaw/ directory resolution, env overrides (MYCLAW_STATE_DIR, etc.)
│   ├── defaults.ts            — Immutable defaults chain: gateway → agent → logging
│   ├── env-substitution.ts    — ${VAR} substitution, $${VAR} escape, MissingEnvVarError
│   └── index.ts               — Barrel re-export
├── sessions/                  — Session store (Sprint 1.2 ✅)
│   ├── session-key.ts         — buildSessionKey() / parseSessionKey() / sessionKeyToSlug()
│   ├── transcript.ts          — appendMessage() / loadTranscript() — JSONL file per session
│   ├── store.ts               — updateSessionMeta() / loadSessionStore() — sessions.json index
│   └── index.ts               — Barrel re-export
├── agent/                     — Agent engine (Sprint 1.3 ✅)
│   ├── types.ts               — RunAgentParams, RunResult, AgentRunEvent, FailoverReason, etc.
│   ├── run.ts                 — runAgent(): LLM call → tool exec loop with retry/failover/compaction
│   ├── streaming.ts           — resolveModel(), streamLLM(), callLLM() — Pi SDK wrappers
│   ├── failover.ts            — classifyError(), profile rotation with exponential-backoff cooldowns
│   ├── context-guard.ts       — 3-level overflow recovery: compact → truncate tool results → fail
│   ├── transcript-helpers.ts  — TranscriptMessage[] ↔ Pi SDK Message[], orphaned tool call repair
│   ├── system-prompt.ts       — buildSystemPrompt() from bootstrap files + runtime info
│   ├── bootstrap-files.ts     — Load AGENTS.md, SOUL.md, etc. from workspace (50k/200k size limits)
│   ├── workspace.ts           — ensureWorkspace(), scaffoldBootstrapFiles()
│   ├── tools/
│   │   ├── apply-patch.ts     — Custom unified-diff tool (uses `diff` npm package)
│   │   └── create-tools.ts    — createAgentTools(): Pi SDK coding tools + apply_patch
│   └── index.ts               — Barrel re-export
scripts/
│   └── test-agent.ts          — CLI test: single-message or interactive REPL mode
dist/                          — build output (gitignored)
docs/                          — architecture notes
│   ├── config.md
│   ├── sessions.md
│   └── agent-engine.md
```

- **Co-located tests:** place test files next to source as `*.test.ts`
- **Environment variables:** use `.env` files (gitignored); commit `.env.example` with placeholder keys

## Config Layer

- **Config file:** `~/.myclaw/myclaw.json` (JSON5 format)
- **Entry point:** `import { loadConfig } from './config/index.js'` → returns `{ config: MyClawConfig, path: string }`
- **Env overrides:** `MYCLAW_STATE_DIR`, `MYCLAW_CONFIG_PATH`, `MYCLAW_GATEWAY_PORT`, `MYCLAW_HOME`
- **Auth profiles:** `config.provider.authProfiles[]` — array of `{ id, apiKey }` for failover rotation
- **Schemas are `.strict()`** — unknown keys are rejected at parse time
- **Defaults are immutable** — each `apply*Defaults()` returns a new object, never mutates
- **Scaffold:** `scaffoldConfigIfMissing()` creates a starter config if none exists

## Session Layer

- **Session key format:** `agent:<agentId>:channel:<channel>:account:<accountId>:peer:<peerKind>:<peerId>`
  - `peerKind`: `"direct"` | `"group"` | `"channel"`
  - Segments are normalised (lowercase, whitespace→underscore, unsafe chars stripped, max 128 chars)
- **Transcript:** one `.jsonl` file per session at `~/.myclaw/sessions/<slug>.jsonl`
  - Line 1 is a session header (`{"type":"session",...}`); subsequent lines are messages
  - `appendMessage(sessionKey, { role, content, ts? })` — create-if-missing + append
  - `loadTranscript(sessionKey)` — returns `TranscriptMessage[]`, skips header and malformed lines
- **Metadata index:** single `~/.myclaw/sessions/sessions.json` — `Record<sessionKey, SessionEntry>`
  - `updateSessionMeta(sessionKey, patch)` — upsert with generated UUID on first create
  - `loadSessionStore()` — mtime-based in-memory cache; returns a `structuredClone` to prevent cache poisoning
  - `pruneSessions(maxAgeMs)` — remove stale entries
- **Entry point:** `import { buildSessionKey, appendMessage, loadTranscript, updateSessionMeta } from './sessions/index.js'`

## Agent Engine

- **Entry point:** `import { runAgent } from './agent/index.js'`
- **Main function:** `runAgent({ sessionKey, userMessage, config, signal?, onEvent? })` → `Promise<RunResult>`
- **LLM integration:** Pi SDK's `streamSimple()` / `completeSimple()` — NOT the `Agent` class
  - Mode selected by `onEvent` presence: with callback → streaming, without → buffered
- **Model resolution:** `resolveModel(provider, modelId, baseUrl?)` — tries Pi SDK registry, falls back to manual `Model` construction
- **Tools (8):** Pi SDK coding tools (`read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`) + custom `apply_patch`
- **Auth failover:** on retriable errors (401/403/429/402/5xx/timeout), rotate to next auth profile with exponential-backoff cooldowns (1s → 2s → 4s → ... → 60s cap)
- **3-level overflow recovery:**
  1. Compact: summarize old messages via LLM, keep last 10
  2. Truncate: shorten oversized tool results (>20k chars)
  3. Give up: throw
- **Usage tracking:** `result.usage` (accumulated totals) + `result.lastCallUsage` (last call only — cache tokens must NOT be summed)
- **Transcript repair:** `repairOrphanedToolCalls()` injects synthetic error results for tool calls left hanging by interrupted runs — API providers reject orphaned tool calls
- **System prompt:** composed from bootstrap files (`AGENTS.md`, `SOUL.md`, `USER.md`, etc.) in XML tags + identity + tools list + safety + runtime info
- **Bootstrap file limits:** 50k chars per file, 200k chars total
- **Workspace:** `~/.myclaw/workspace/` — scaffolds starter `AGENTS.md` on first run

### Key types

```typescript
interface RunAgentParams {
  sessionKey: string;
  userMessage: string;
  config: MyClawConfig;
  signal?: AbortSignal;
  onEvent?: AgentEventCallback;
}

interface RunResult {
  reply: string;
  usage: Usage;           // accumulated across all LLM calls
  lastCallUsage: Usage;   // last API call only (for context-size display)
  iterations: number;
  maxIterationsReached: boolean;
}

type AgentRunEvent =
  | { type: "llm_start"; iteration: number }
  | { type: "llm_stream"; event: AssistantMessageEvent }
  | { type: "llm_end"; message: AssistantMessage }
  | { type: "tool_start"; toolName: string; toolCallId: string }
  | { type: "tool_end"; toolName: string; toolCallId: string; durationMs: number; isError: boolean }
  | { type: "retry"; attempt: number; reason: FailoverReason; profileId: string }
  | { type: "compaction"; oldCount: number; newCount: number }
  | { type: "done"; result: RunResult };

type FailoverReason = "auth" | "rate_limit" | "billing" | "timeout" | "quota" | "context_overflow" | "unknown";
```

### Pi SDK packages

| Package | What we use |
|---|---|
| `@mariozechner/pi-ai` | `streamSimple()`, `completeSimple()`, `getModel()`, `Message` types, `Usage`, `Context` |
| `@mariozechner/pi-agent-core` | `AgentTool` type |
| `@mariozechner/pi-coding-agent` | `createCodingTools(cwd)` → `[read, bash, edit, write, grep, find, ls]` |
| `@sinclair/typebox` | Tool parameter schemas (used by Pi SDK tool format) |
| `diff` | `parsePatch()`, `applyPatch()` for the `apply_patch` tool |

### Pi SDK key facts

- `Message = UserMessage | AssistantMessage | ToolResultMessage` (no SystemMessage — system prompt is in `Context`)
- `ToolResultMessage.role` is `"toolResult"` (not `"tool"`)
- `AssistantMessage.content` is `(TextContent | ThinkingContent | ToolCall)[]`
- `getModel()` returns `undefined` (not throws) for unknown models
- `AgentTool<TParams>` generic variance: use `AgentTool<any>` for arrays mixing different param types

## Conventions

- Write all code in **strict TypeScript** — no `any`, no `@ts-ignore`
- Use **Zod** for all runtime validation (configs, external inputs, API payloads)
- Use **JSON5** (not plain JSON) for configuration files that need comments or trailing commas
- Prefer named exports over default exports
- Use Node.js built-in modules with the `node:` prefix (e.g., `import fs from 'node:fs/promises'`)
- Keep functions small and pure where possible; side-effects at the edges
- Barrel exports in each module's `index.ts`
- Error classification patterns must be lowercase (message is lowercased before comparison)

## Adding Dependencies

Always use `pnpm add <pkg>` (or `pnpm add -D <pkg>` for dev). Run `pnpm typecheck` and `pnpm test` after adding a dependency to verify nothing breaks.
