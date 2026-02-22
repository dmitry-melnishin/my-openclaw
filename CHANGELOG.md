# Changelog

All notable changes to this project will be documented here.

---

## [Unreleased]

- `feat(config):` implement config layer with JSON5 loading, Zod validation, env substitution, and auth profiles.
- `feat(sessions):` implement session store — deterministic session key builder, JSONL transcript append/load, and JSON metadata index with mtime-based cache and prune support.
- `feat(agent):` implement agent engine using Pi SDK (`@mariozechner/pi-*` v0.54.0) — LLM call loop with tool execution, real-time streaming via `streamSimple()`, context overflow auto-compaction, auth profile failover, and 5 tools (read/write/edit/bash from `createCodingTools()` + custom `apply_patch`).
