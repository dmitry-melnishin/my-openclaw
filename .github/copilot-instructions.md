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
dist/                          — build output (gitignored)
```

- **Co-located tests:** place test files next to source as `*.test.ts` (they are excluded from `tsconfig` compilation but picked up by Vitest)
- **Environment variables:** use `.env` files (gitignored); commit `.env.example` with placeholder keys

## Config Layer

- **Config file:** `~/.myclaw/myclaw.json` (JSON5 format)
- **Entry point:** `import { loadConfig } from './config/index.js'` → returns `{ config: MyClawConfig, path: string }`
- **Env overrides:** `MYCLAW_STATE_DIR`, `MYCLAW_CONFIG_PATH`, `MYCLAW_GATEWAY_PORT`, `MYCLAW_HOME`
- **Auth profiles:** `config.provider.authProfiles[]` — array of `{ id, apiKey }` for failover rotation
- **Schemas are `.strict()`** — unknown keys are rejected at parse time
- **Defaults are immutable** — each `apply*Defaults()` returns a new object, never mutates
- **Scaffold:** `scaffoldConfigIfMissing()` creates a starter config if none exists

## Conventions

- Write all code in **strict TypeScript** — no `any`, no `@ts-ignore`
- Use **Zod** for all runtime validation (configs, external inputs, API payloads)
- Use **JSON5** (not plain JSON) for configuration files that need comments or trailing commas
- Prefer named exports over default exports
- Use Node.js built-in modules with the `node:` prefix (e.g., `import fs from 'node:fs/promises'`)
- Keep functions small and pure where possible; side-effects at the edges

## Adding Dependencies

Always use `pnpm add <pkg>` (or `pnpm add -D <pkg>` for dev). Run `pnpm typecheck` and `pnpm test` after adding a dependency to verify nothing breaks.
