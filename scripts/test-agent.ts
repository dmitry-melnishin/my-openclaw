#!/usr/bin/env node
/**
 * CLI test script for the agent engine.
 *
 * Usage:
 *   node --import tsx scripts/test-agent.ts "Your message here"
 *   node --import tsx scripts/test-agent.ts                      # interactive mode
 *
 * Reads config from ~/.myclaw/myclaw.json, creates a CLI session,
 * and runs the agent with the given message.
 *
 * Set MYCLAW_DEBUG=1 for verbose output (thinking tokens, stack traces, usage per turn).
 * Set MYCLAW_NO_STREAM=1 to disable streaming (buffered mode).
 */

// Load .env file if present (Node 22 built-in — no dotenv needed)
try { process.loadEnvFile(); } catch { /* .env not found — rely on shell env */ }

import readline from "node:readline";

import { loadConfig, scaffoldConfigIfMissing } from "../src/config/index.js";
import { buildSessionKey } from "../src/sessions/index.js";
import { runAgent, type AgentRunEvent } from "../src/agent/index.js";

// ── Env flags ──────────────────────────────────────────────────────

const DEBUG = process.env.MYCLAW_DEBUG === "1";
const STREAM = process.env.MYCLAW_NO_STREAM !== "1";

// ── Helpers ────────────────────────────────────────────────────────

function log(msg: string): void {
  console.log(msg);
}

function debug(msg: string): void {
  if (DEBUG) console.log(`[debug] ${msg}`);
}

// ── Event handler ──────────────────────────────────────────────────

function createEventHandler(): (event: AgentRunEvent) => void {
  return (event: AgentRunEvent) => {
    switch (event.type) {
      case "llm_stream": {
        const inner = event.event;
        switch (inner.type) {
          case "text_delta":
            process.stdout.write(inner.delta);
            break;
          case "thinking_delta":
            if (DEBUG) process.stdout.write(`\x1b[2m${inner.delta}\x1b[0m`);
            break;
          case "toolcall_end":
            log(`\n🔧 Tool call: ${inner.toolCall.name}`);
            break;
          case "error":
            log(`\n❌ Stream error: ${inner.reason}`);
            break;
          case "done":
            process.stdout.write("\n");
            break;
        }
        break;
      }
      case "tool_start":
        debug(`[tool:${event.toolName}] started`);
        break;
      case "tool_end":
        log(
          `  ${event.isError ? "❌" : "✅"} ${event.toolName} (${event.durationMs}ms)`,
        );
        break;
      case "retry":
        log(
          `\n⟳ Retry #${event.attempt}: ${event.reason} → profile "${event.profileId}"`,
        );
        break;
      case "compaction":
        log(`\n📦 Compaction: ${event.oldCount} → ${event.newCount} messages`);
        break;
    }
  };
}

// ── Session key ────────────────────────────────────────────────────

const sessionKey = buildSessionKey({
  channel: "cli",
  peerKind: "direct",
  peerId: "cli_test_user",
});

// ── Single-message mode ────────────────────────────────────────────

async function runOnce(message: string): Promise<void> {
  scaffoldConfigIfMissing();
  const { config, path: configPath } = loadConfig();

  log(`📋 Config: ${configPath}`);
  log(`🤖 Model: ${config.provider.name}/${config.provider.model}`);
  log(
    `🔑 Profiles: ${config.provider.authProfiles.map((p) => p.id).join(", ")}`,
  );
  log(`📝 Session: ${sessionKey}`);
  log(`💬 User: ${message}\n`);

  const startTime = Date.now();

  try {
    const result = await runAgent({
      sessionKey,
      userMessage: message,
      config,
      onEvent: STREAM ? createEventHandler() : undefined,
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    if (!STREAM) {
      log(`\n🤖 Assistant: ${result.reply}\n`);
    }

    log(`\n─── Result ───`);
    log(`⏱️  ${elapsed}s | ${result.iterations} iteration(s)`);

    if (result.usage.totalTokens > 0) {
      log(
        `📊 Tokens: ${result.usage.input} in / ${result.usage.output} out (total: ${result.usage.totalTokens})`,
      );
    }

    if (result.lastCallUsage.cacheRead > 0 || result.lastCallUsage.cacheWrite > 0) {
      log(
        `💾 Cache: ${result.lastCallUsage.cacheRead} read / ${result.lastCallUsage.cacheWrite} write`,
      );
    }

    if (result.maxIterationsReached) {
      log(`⚠️  Max iterations reached`);
    }
  } catch (err) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log(`\n❌ Agent error after ${elapsed}s:`);
    if (err instanceof Error) {
      log(`  ${err.name}: ${err.message}`);
      if (DEBUG && err.stack) log(err.stack);
    } else {
      log(`  ${String(err)}`);
    }
    process.exitCode = 1;
  }
}

// ── Interactive REPL mode ──────────────────────────────────────────

async function runInteractive(): Promise<void> {
  scaffoldConfigIfMissing();
  const { config, path: configPath } = loadConfig();

  log(`📋 Config: ${configPath}`);
  log(`🤖 Model: ${config.provider.name}/${config.provider.model}`);
  log(
    `🔑 Profiles: ${config.provider.authProfiles.map((p) => p.id).join(", ")}`,
  );
  log(`📝 Session: ${sessionKey}`);
  log(`\nType a message and press Enter. Type "exit" or Ctrl+C to quit.\n`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "You: ",
  });

  rl.prompt();

  for await (const line of rl) {
    const message = line.trim();
    if (!message) {
      rl.prompt();
      continue;
    }
    if (message === "exit" || message === "quit") {
      log("Goodbye!");
      break;
    }

    log("");

    const startTime = Date.now();

    try {
      const result = await runAgent({
        sessionKey,
        userMessage: message,
        config,
        onEvent: STREAM ? createEventHandler() : undefined,
      });

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      if (!STREAM) {
        log(`\n🤖 ${result.reply}`);
      }

      debug(
        `[${elapsed}s | ${result.usage.input}→${result.usage.output} tokens | ${result.iterations} iter]`,
      );

      if (result.maxIterationsReached) {
        log("⚠️  Max iterations reached");
      }
    } catch (err) {
      log(`❌ Error: ${err instanceof Error ? err.message : String(err)}`);
    }

    log("");
    rl.prompt();
  }

  rl.close();
}

// ── Entry point ────────────────────────────────────────────────────

const userMessage = process.argv.slice(2).join(" ").trim();

if (userMessage) {
  runOnce(userMessage);
} else {
  runInteractive();
}
