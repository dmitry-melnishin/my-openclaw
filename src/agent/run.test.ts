/**
 * Integration tests for the agent run loop.
 *
 * Mocks Pi SDK LLM calls to test the full pipeline.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { MyClawConfig } from "../config/index.js";
import { loadTranscript } from "../sessions/index.js";
import type { AgentRunEvent } from "./types.js";

// Mock the streaming module to avoid real LLM calls
vi.mock("./streaming.js", () => ({
  resolveModel: vi.fn(() => ({
    id: "test-model",
    name: "test-model",
    api: "anthropic-messages",
    provider: "anthropic",
    baseUrl: "https://api.anthropic.com",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: 8192,
  })),
  streamLLM: vi.fn(),
  callLLM: vi.fn(),
}));

// Mock createCodingTools to avoid filesystem-dependent Pi SDK tools
vi.mock("@mariozechner/pi-coding-agent", () => ({
  createCodingTools: vi.fn(() => []),
}));

import { runAgent } from "./run.js";
import { callLLM, streamLLM } from "./streaming.js";

const mockedCallLLM = vi.mocked(callLLM);
const mockedStreamLLM = vi.mocked(streamLLM);

// ── Helpers ──────────────────────────────────────────────────────────

function makeAssistantMessage(
  text: string,
  overrides?: Partial<{
    toolCalls: { id: string; name: string; arguments: Record<string, any> }[];
    usage: { input: number; output: number };
  }>,
) {
  const content: any[] = [{ type: "text", text }];
  if (overrides?.toolCalls) {
    for (const tc of overrides.toolCalls) {
      content.push({ type: "toolCall", ...tc });
    }
  }
  const u = overrides?.usage ?? { input: 100, output: 50 };
  return {
    role: "assistant" as const,
    content,
    api: "anthropic-messages",
    provider: "anthropic",
    model: "test-model",
    usage: {
      input: u.input,
      output: u.output,
      cacheRead: 10,
      cacheWrite: 5,
      totalTokens: u.input + u.output,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop" as const,
    timestamp: Date.now(),
  };
}

function makeConfig(tmpDir: string): MyClawConfig {
  return {
    provider: {
      name: "anthropic",
      model: "test-model",
      authProfiles: [
        { id: "primary", apiKey: "sk-test-1" },
        { id: "fallback", apiKey: "sk-test-2" },
      ],
    },
    agent: {
      workspaceDir: path.join(tmpDir, "workspace"),
      maxIterations: 10,
      maxRetries: 3,
      maxToolResultChars: 50_000,
    },
  } as MyClawConfig;
}

// ── Test suite ───────────────────────────────────────────────────────

describe("runAgent", () => {
  let tmpDir: string;
  const sessionKey = "agent:main:channel:test:account:default:peer:direct:test_user";

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "myclaw-run-test-"));
    vi.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns a simple text reply (no streaming)", async () => {
    const reply = makeAssistantMessage("Hello! I'm MyClaw.");
    mockedCallLLM.mockResolvedValueOnce(reply);

    const result = await runAgent({
      sessionKey,
      userMessage: "Hi there",
      config: makeConfig(tmpDir),
    });

    expect(result.reply).toBe("Hello! I'm MyClaw.");
    expect(result.iterations).toBe(1);
    expect(result.maxIterationsReached).toBe(false);
    expect(result.usage.totalTokens).toBe(150);
    expect(mockedCallLLM).toHaveBeenCalledTimes(1);
    expect(mockedStreamLLM).not.toHaveBeenCalled();
  });

  it("persists new messages to transcript", async () => {
    const reply = makeAssistantMessage("Persisted reply");
    mockedCallLLM.mockResolvedValueOnce(reply);

    await runAgent({
      sessionKey,
      userMessage: "Save this",
      config: makeConfig(tmpDir),
    });

    const transcript = loadTranscript(sessionKey);
    expect(transcript.length).toBeGreaterThanOrEqual(2);
    expect(transcript.some((m) => m.role === "user" && m.content === "Save this")).toBe(true);
    expect(transcript.some((m) => m.role === "assistant")).toBe(true);
  });

  it("uses streamLLM when onEvent is provided", async () => {
    const reply = makeAssistantMessage("Streamed reply");
    mockedStreamLLM.mockResolvedValueOnce(reply);

    const events: AgentRunEvent[] = [];
    await runAgent({
      sessionKey,
      userMessage: "Stream me",
      config: makeConfig(tmpDir),
      onEvent: (e) => events.push(e),
    });

    expect(mockedStreamLLM).toHaveBeenCalledTimes(1);
    expect(mockedCallLLM).not.toHaveBeenCalled();
  });

  it("handles tool call → execution → second LLM call", async () => {
    // First: tool call, Second: final reply. No onEvent = callLLM.
    const toolCallMsg = makeAssistantMessage("Let me check.", {
      toolCalls: [{ id: "tc1", name: "apply_patch", arguments: { patch: "invalid" } }],
    });
    const finalMsg = makeAssistantMessage("Done!");

    mockedCallLLM
      .mockResolvedValueOnce(toolCallMsg)
      .mockResolvedValueOnce(finalMsg);

    const result = await runAgent({
      sessionKey,
      userMessage: "Apply patch",
      config: makeConfig(tmpDir),
    });

    expect(result.reply).toBe("Done!");
    expect(result.iterations).toBe(2);
    expect(mockedCallLLM).toHaveBeenCalledTimes(2);
  });

  it("handles tool call flow with streaming", async () => {
    const toolCallMsg = makeAssistantMessage("Checking...", {
      toolCalls: [{ id: "tc1", name: "apply_patch", arguments: { patch: "bad" } }],
    });
    const finalMsg = makeAssistantMessage("All done.");

    mockedStreamLLM
      .mockResolvedValueOnce(toolCallMsg)
      .mockResolvedValueOnce(finalMsg);

    const events: AgentRunEvent[] = [];
    const result = await runAgent({
      sessionKey,
      userMessage: "Do it",
      config: makeConfig(tmpDir),
      onEvent: (e) => events.push(e),
    });

    expect(result.reply).toBe("All done.");
    expect(result.iterations).toBe(2);

    const toolStartEvents = events.filter((e) => e.type === "tool_start");
    const toolEndEvents = events.filter((e) => e.type === "tool_end");
    expect(toolStartEvents.length).toBe(1);
    expect(toolEndEvents.length).toBe(1);
  });

  it("retries on auth error and rotates profile", async () => {
    const authError = Object.assign(new Error("Unauthorized"), { status: 401 });
    const reply = makeAssistantMessage("Success after retry");

    // First streamLLM call fails, second succeeds (onEvent → streamLLM)
    mockedStreamLLM
      .mockRejectedValueOnce(authError)
      .mockResolvedValueOnce(reply);

    const events: AgentRunEvent[] = [];
    const result = await runAgent({
      sessionKey,
      userMessage: "Retry test",
      config: makeConfig(tmpDir),
      onEvent: (e) => events.push(e),
    });

    expect(result.reply).toBe("Success after retry");
    const retryEvents = events.filter((e) => e.type === "retry");
    expect(retryEvents.length).toBe(1);
    if (retryEvents[0].type === "retry") {
      expect(retryEvents[0].reason).toBe("auth");
    }
  });

  it("stops at maxIterations", async () => {
    // Tool call that the run loop will execute each iteration
    const toolCallMsg = makeAssistantMessage("Calling tool...", {
      toolCalls: [{ id: "tc-loop", name: "apply_patch", arguments: { patch: "not a real patch" } }],
    });

    mockedCallLLM.mockResolvedValue(toolCallMsg);

    const config = makeConfig(tmpDir);
    (config.agent as any).maxIterations = 3;

    const result = await runAgent({
      sessionKey,
      userMessage: "Loop forever",
      config,
    });

    expect(result.maxIterationsReached).toBe(true);
    expect(result.iterations).toBe(3);
  });

  it("respects abort signal", async () => {
    const controller = new AbortController();
    controller.abort(new Error("User cancelled"));

    mockedCallLLM.mockResolvedValue(makeAssistantMessage("Should not reach"));

    await expect(
      runAgent({
        sessionKey,
        userMessage: "Cancel me",
        config: makeConfig(tmpDir),
        signal: controller.signal,
      }),
    ).rejects.toThrow();
  });

  it("tracks usage: totalUsage accumulates, lastCallUsage is last only", async () => {
    const msg1 = makeAssistantMessage("First call", {
      toolCalls: [{ id: "tc1", name: "apply_patch", arguments: { patch: "not a real patch" } }],
      usage: { input: 100, output: 50 },
    });
    const msg2 = makeAssistantMessage("Second call", {
      usage: { input: 200, output: 100 },
    });

    mockedCallLLM
      .mockResolvedValueOnce(msg1)
      .mockResolvedValueOnce(msg2);

    const result = await runAgent({
      sessionKey,
      userMessage: "Track usage",
      config: makeConfig(tmpDir),
    });

    // Total = sum of input/output
    expect(result.usage.input).toBe(300);
    expect(result.usage.output).toBe(150);
    // Last call = second call only
    expect(result.lastCallUsage.input).toBe(200);
    expect(result.lastCallUsage.output).toBe(100);
  });

  it("handles unknown tool gracefully", async () => {
    const toolCallMsg = makeAssistantMessage("Calling unknown tool", {
      toolCalls: [{ id: "tc-unknown", name: "nonexistent_tool", arguments: {} }],
    });
    const finalMsg = makeAssistantMessage("Tool not found");

    // No onEvent → callLLM
    mockedCallLLM
      .mockResolvedValueOnce(toolCallMsg)
      .mockResolvedValueOnce(finalMsg);

    const result = await runAgent({
      sessionKey,
      userMessage: "Use unknown tool",
      config: makeConfig(tmpDir),
    });

    expect(result.reply).toBe("Tool not found");
  });

  it("throws on non-retriable error", async () => {
    const unknownError = new Error("Something completely unexpected");
    mockedCallLLM.mockRejectedValueOnce(unknownError);

    await expect(
      runAgent({
        sessionKey,
        userMessage: "Fail hard",
        config: makeConfig(tmpDir),
      }),
    ).rejects.toThrow("Something completely unexpected");
  });
});
