/**
 * Tests for context-guard: overflow detection, truncation, compaction.
 *
 * Uses Pi SDK Message types (UserMessage, AssistantMessage, ToolResultMessage).
 */

import { describe, it, expect } from "vitest";
import {
  isContextOverflowError,
  truncateToolResult,
  formatMessagesForSummary,
} from "./context-guard.js";
import type {
  Message,
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
} from "@mariozechner/pi-ai";
import { emptyUsage } from "./types.js";

/** Helper to create a UserMessage. */
function userMsg(text: string): UserMessage {
  return { role: "user", content: text, timestamp: Date.now() };
}

/** Helper to create an AssistantMessage with text content. */
function assistantMsg(text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "",
    provider: "",
    model: "",
    usage: emptyUsage(),
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

/** Helper to create an AssistantMessage with tool calls. */
function assistantToolCallMsg(
  toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>,
  text = "",
): AssistantMessage {
  const content: AssistantMessage["content"] = [];
  if (text) content.push({ type: "text", text });
  for (const tc of toolCalls) {
    content.push({ type: "toolCall", ...tc });
  }
  return {
    role: "assistant",
    content,
    api: "",
    provider: "",
    model: "",
    usage: emptyUsage(),
    stopReason: "toolUse",
    timestamp: Date.now(),
  };
}

/** Helper to create a ToolResultMessage. */
function toolResultMsg(toolCallId: string, text: string): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId,
    toolName: "test_tool",
    content: [{ type: "text", text }],
    isError: false,
    timestamp: Date.now(),
  };
}

describe("isContextOverflowError", () => {
  it("detects 'context length exceeded'", () => {
    expect(
      isContextOverflowError(new Error("This model's context length has been exceeded")),
    ).toBe(true);
  });

  it("detects 'maximum tokens'", () => {
    expect(
      isContextOverflowError(new Error("maximum tokens limit exceeded")),
    ).toBe(true);
  });

  it("detects 'prompt too long'", () => {
    expect(
      isContextOverflowError(new Error("prompt is too long for this model")),
    ).toBe(true);
  });

  it("detects 'request too large'", () => {
    expect(
      isContextOverflowError(new Error("request_too_large")),
    ).toBe(true);
  });

  it("detects HTTP 413", () => {
    const err = Object.assign(new Error("Payload Too Large"), { status: 413 });
    expect(isContextOverflowError(err)).toBe(true);
  });

  it("detects 'exceeds model context window'", () => {
    expect(
      isContextOverflowError(new Error("exceeds model context window")),
    ).toBe(true);
  });

  it("does not false-positive on unrelated errors", () => {
    expect(isContextOverflowError(new Error("Invalid API key"))).toBe(false);
    expect(isContextOverflowError(new Error("Rate limit exceeded"))).toBe(false);
    expect(isContextOverflowError(new Error("Network error"))).toBe(false);
  });

  it("detects from string (non-Error)", () => {
    expect(isContextOverflowError("context window overflow")).toBe(true);
  });
});

describe("truncateToolResult", () => {
  it("returns short strings unchanged", () => {
    const short = "Hello, world!";
    expect(truncateToolResult(short, 1000)).toBe(short);
  });

  it("truncates long strings", () => {
    const long = "x".repeat(200);
    const result = truncateToolResult(long, 100);
    expect(result.length).toBeLessThan(200);
    expect(result).toContain("... [output truncated]");
  });

  it("tries to cut at newline boundary", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}: ${"x".repeat(10)}`);
    const content = lines.join("\n");
    const result = truncateToolResult(content, 150);
    expect(result).toContain("... [output truncated]");
    // Should end at a newline before the suffix
    const beforeSuffix = result.split("\n... [output truncated]")[0];
    expect(beforeSuffix.endsWith("\n") || !beforeSuffix.includes("Line")).toBeFalsy;
  });

  it("uses default max when no limit specified", () => {
    const short = "short";
    expect(truncateToolResult(short)).toBe(short);
  });
});

describe("formatMessagesForSummary", () => {
  it("formats user and assistant messages", () => {
    const messages: Message[] = [
      userMsg("Hello"),
      assistantMsg("Hi there!"),
    ];
    const result = formatMessagesForSummary(messages);
    expect(result).toContain("User: Hello");
    expect(result).toContain("Assistant: Hi there!");
  });

  it("abbreviates tool results", () => {
    const longContent = "x".repeat(600);
    const messages: Message[] = [
      toolResultMsg("tc_1", longContent),
    ];
    const result = formatMessagesForSummary(messages);
    expect(result).toContain("[Tool result]");
    expect(result).toContain("...");
    expect(result.length).toBeLessThan(longContent.length);
  });

  it("shows tool call names for assistant messages with tools", () => {
    const messages: Message[] = [
      assistantToolCallMsg([
        { id: "tc_1", name: "bash", arguments: { command: "ls" } },
        { id: "tc_2", name: "read", arguments: { path: "foo" } },
      ]),
    ];
    const result = formatMessagesForSummary(messages);
    expect(result).toContain("bash");
    expect(result).toContain("read");
  });

  it("handles empty messages array", () => {
    expect(formatMessagesForSummary([])).toBe("");
  });
});
