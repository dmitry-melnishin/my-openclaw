#!/usr/bin/env node
/**
 * CLI test script for the agent engine.
 *
 * Usage:
 *   npx tsx src/agent/cli-test.ts "Your message here"
 *   npx tsx src/agent/cli-test.ts                      # interactive mode
 *
 * Reads config from ~/.myclaw/myclaw.json, creates a CLI session,
 * and runs the agent with the given message.
 *
 * Set MYCLAW_DEBUG=1 for verbose streaming output.
 */

import readline from "node:readline";

import { loadConfig, scaffoldConfigIfMissing } from "../config/index.js";
import { buildSessionKey } from "../sessions/index.js";
import { runAgent } from "./run.js";
import type { AssistantMessageEvent } from "@mariozechner/pi-ai";

// ── Helpers ─────────────────────────────────────────────────────────

const DEBUG = process.env.MYCLAW_DEBUG === "1";
const STREAM = process.env.MYCLAW_NO_STREAM !== "1";

function log(msg: string): void {
  console.log(msg);
}

function debug(msg: string): void {
  if (DEBUG) console.log(`[debug] ${msg}`);
}

/**
 * Streaming event handler — writes text to stdout as it arrives.
 */
function handleStreamEvent(event: AssistantMessageEvent): void {
  switch (event.type) {
    case "text_delta":
      process.stdout.write(event.delta);
      break;
    case "thinking_delta":
      if (DEBUG) process.stdout.write(`\x1b[2m${event.delta}\x1b[0m`);
      break;
    case "toolcall_end":
      log(`\n🔧 Tool call: ${event.toolCall.name}`);
      break;
    case "error":
      log(`\n❌ Stream error: ${event.reason}`);
      break;
    case "done":
      // Final newline after streamed text
      process.stdout.write("\n");
      break;
  }
}

// ── Session key ─────────────────────────────────────────────────────

const sessionKey = buildSessionKey({
  channel: "cli",
  peerKind: "direct",
  peerId: "cli_test_user",
});

// ── Main ────────────────────────────────────────────────────────────

async function runOnce(message: string): Promise<void> {
  // Ensure config exists
  scaffoldConfigIfMissing();
  const { config, path: configPath } = loadConfig();

  log(`\n📋 Config: ${configPath}`);
  log(`🤖 Model: ${config.provider.name}/${config.provider.model}`);
  log(`📝 Session: ${sessionKey}`);
  log(`\n💬 User: ${message}\n`);

  const startTime = Date.now();

  try {
    const result = await runAgent({
      sessionKey,
      userMessage: message,
      config,
      onEvent: STREAM ? handleStreamEvent : undefined,
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    if (!STREAM) {
      log(`\n🤖 Assistant: ${result.reply}\n`);
    } else {
      // Streamed text was already written — just show the label
      log(``);
    }
    log(`─── Result ───`);
    log(`⏱️  ${elapsed}s | ${result.iterations} iteration(s)`);

    if (result.usage.totalTokens > 0) {
      log(
        `📊 Tokens: ${result.usage.input} in / ${result.usage.output} out`,
      );
    }

    if (result.maxIterationsReached) {
      log(`⚠️  Max iterations reached`);
    }

    if (result.error) {
      log(`❌ Error: ${result.error.kind} — ${result.error.message}`);
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

async function runInteractive(): Promise<void> {
  // Ensure config exists
  scaffoldConfigIfMissing();
  const { config, path: configPath } = loadConfig();

  log(`📋 Config: ${configPath}`);
  log(`🤖 Model: ${config.provider.name}/${config.provider.model}`);
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
        onEvent: STREAM ? handleStreamEvent : undefined,
      });

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      if (!STREAM) {
        log(`\n🤖 ${result.reply}`);
      }

      if (result.usage.totalTokens > 0) {
        debug(
          `[${elapsed}s | ${result.usage.input}→${result.usage.output} tokens | ${result.iterations} iter]`,
        );
      }

      if (result.maxIterationsReached) {
        log("⚠️  Max iterations reached");
      }
    } catch (err) {
      log(
        `❌ Error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    log("");
    rl.prompt();
  }

  rl.close();
}

// ── Entry point ─────────────────────────────────────────────────────

const userMessage = process.argv.slice(2).join(" ").trim();

if (userMessage) {
  runOnce(userMessage);
} else {
  runInteractive();
}
