# Changelog

All notable changes to this project will be documented here.

---

## [Unreleased]

- `feat(config):` implement config layer with JSON5 loading, Zod validation, env substitution, and auth profiles.
- `feat(sessions):` implement session store — deterministic session key builder, JSONL transcript append/load, and JSON metadata index with mtime-based cache and prune support.
- `feat(agent):` implement agent engine — LLM call → tool execution loop with streaming, auth profile failover with exponential-backoff cooldowns, 3-level context overflow recovery, orphaned tool call repair, Pi SDK coding tools + custom `apply_patch`, bootstrap-file system prompt, and CLI test REPL.
