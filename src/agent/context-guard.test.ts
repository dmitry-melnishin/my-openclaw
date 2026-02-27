import { describe, it, expect } from "vitest";

import type {
  Message,
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  TextContent,
  Usage,
} from "@mariozechner/pi-ai";

import {
  detectContextOverflow,
  buildCompactionPrompt,
  compactMessages,
  truncateOversizedToolResults,
} from "./context-guard.js";

// ── Helpers ──────────────────────────────────────────────────────────

const ZERO_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function mkUser(content: string): UserMessage {
  return { role: "user", content, timestamp: Date.now() };
}

function mkAssistant(text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }] as TextContent[],
    api: "messages",
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    usage: { ...ZERO_USAGE },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

function mkToolResult(
  toolName: string,
  text: string,
  opts?: { isError?: boolean },
): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: `call_${toolName}_${Date.now()}`,
    toolName,
    content: [{ type: "text", text }] as TextContent[],
    isError: opts?.isError ?? false,
    timestamp: Date.now(),
  };
}

// ── detectContextOverflow ────────────────────────────────────────────

describe("detectContextOverflow", () => {
  it("returns true for string containing 'context_length_exceeded'", () => {
    expect(detectContextOverflow("Error: context_length_exceeded")).toBe(true);
  });

  it("returns true for 'too many tokens'", () => {
    expect(detectContextOverflow("too many tokens in the request")).toBe(true);
  });

  it("returns true for 'token limit'", () => {
    expect(detectContextOverflow("You have exceeded the token limit")).toBe(true);
  });

  it("returns true for 'context window'", () => {
    expect(detectContextOverflow("exceeds context window size")).toBe(true);
  });

  it("returns true for 'context length'", () => {
    expect(detectContextOverflow("context length has been exceeded")).toBe(true);
  });

  it("returns true for 'maximum context'", () => {
    expect(detectContextOverflow("maximum context has been reached")).toBe(true);
  });

  it("returns true for 'prompt is too long'", () => {
    expect(detectContextOverflow("prompt is too long for this model")).toBe(true);
  });

  it("returns true for 'request too large'", () => {
    expect(detectContextOverflow("request too large")).toBe(true);
  });

  it("returns true for 'max_tokens'", () => {
    expect(detectContextOverflow("max_tokens exceeded")).toBe(true);
  });

  it("returns true for 'maximum number of tokens'", () => {
    expect(detectContextOverflow("maximum number of tokens exceeded")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(detectContextOverflow("CONTEXT_LENGTH_EXCEEDED")).toBe(true);
    expect(detectContextOverflow("Token Limit reached")).toBe(true);
  });

  it("returns true for Error objects with .message matching a pattern", () => {
    const err = new Error("context_length_exceeded");
    expect(detectContextOverflow(err)).toBe(true);
  });

  it("returns true for plain objects with .message", () => {
    expect(detectContextOverflow({ message: "too many tokens" })).toBe(true);
  });

  it("returns true for objects with .errorMessage", () => {
    expect(detectContextOverflow({ errorMessage: "request too large" })).toBe(true);
  });

  it("returns false for unrelated error strings", () => {
    expect(detectContextOverflow("network timeout")).toBe(false);
    expect(detectContextOverflow("401 unauthorized")).toBe(false);
  });

  it("returns false for unrelated Error objects", () => {
    expect(detectContextOverflow(new Error("ENOENT"))).toBe(false);
  });

  it("returns false for null and undefined", () => {
    expect(detectContextOverflow(null)).toBe(false);
    expect(detectContextOverflow(undefined)).toBe(false);
  });

  it("returns false for non-string, non-object values", () => {
    expect(detectContextOverflow(42)).toBe(false);
    expect(detectContextOverflow(true)).toBe(false);
  });

  it("returns false for objects without message or errorMessage", () => {
    expect(detectContextOverflow({ code: 400 })).toBe(false);
  });
});

// ── buildCompactionPrompt ────────────────────────────────────────────

describe("buildCompactionPrompt", () => {
  it("includes the summarize instruction at the start", () => {
    const prompt = buildCompactionPrompt([mkUser("hello")]);
    expect(prompt).toContain("Summarize the following conversation");
  });

  it("includes closing instruction for concise summary", () => {
    const prompt = buildCompactionPrompt([mkUser("hello")]);
    expect(prompt).toContain("Provide a concise summary (1-3 paragraphs):");
  });

  it("serializes UserMessage content", () => {
    const prompt = buildCompactionPrompt([mkUser("What is the weather?")]);
    expect(prompt).toContain("User: What is the weather?");
  });

  it("serializes AssistantMessage text content", () => {
    const prompt = buildCompactionPrompt([mkAssistant("It is sunny today.")]);
    expect(prompt).toContain("Assistant: It is sunny today.");
  });

  it("serializes ToolResultMessage content with tool name", () => {
    const prompt = buildCompactionPrompt([mkToolResult("bash", "exit code 0")]);
    expect(prompt).toContain("Tool (bash): exit code 0");
  });

  it("handles mixed message types in order", () => {
    const messages: Message[] = [
      mkUser("run ls"),
      mkAssistant("I will run ls for you."),
      mkToolResult("bash", "file1.ts\nfile2.ts"),
    ];
    const prompt = buildCompactionPrompt(messages);

    const userIdx = prompt.indexOf("User: run ls");
    const assistantIdx = prompt.indexOf("Assistant: I will run ls");
    const toolIdx = prompt.indexOf("Tool (bash):");

    expect(userIdx).toBeGreaterThan(-1);
    expect(assistantIdx).toBeGreaterThan(userIdx);
    expect(toolIdx).toBeGreaterThan(assistantIdx);
  });

  it("truncates long tool result text at 500 chars", () => {
    const longText = "x".repeat(1000);
    const prompt = buildCompactionPrompt([mkToolResult("read_file", longText)]);
    // The tool line should contain at most 500 chars of the text
    const toolLine = prompt.split("\n").find((l) => l.startsWith("Tool (read_file):"))!;
    // "Tool (read_file): " prefix + 500 chars max
    expect(toolLine.length).toBeLessThanOrEqual("Tool (read_file): ".length + 500);
  });

  it("returns empty conversation block for empty messages array", () => {
    const prompt = buildCompactionPrompt([]);
    expect(prompt).toContain("Summarize");
    expect(prompt).toContain("Provide a concise summary");
  });

  it("joins multiple AssistantMessage text parts with space", () => {
    const msg: AssistantMessage = {
      role: "assistant",
      content: [
        { type: "text", text: "Part one." } as TextContent,
        { type: "text", text: "Part two." } as TextContent,
      ],
      api: "messages",
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      usage: { ...ZERO_USAGE },
      stopReason: "stop",
      timestamp: Date.now(),
    };
    const prompt = buildCompactionPrompt([msg]);
    expect(prompt).toContain("Assistant: Part one. Part two.");
  });
});

// ── compactMessages ──────────────────────────────────────────────────

describe("compactMessages", () => {
  const mockSummarize = async (_prompt: string) => "This is a summary of old messages.";

  it("returns messages as-is when length <= recentCount", async () => {
    const messages: Message[] = [mkUser("a"), mkUser("b"), mkUser("c")];
    const result = await compactMessages(messages, mockSummarize, 5);
    expect(result).toBe(messages);
  });

  it("returns messages as-is when length equals recentCount", async () => {
    const messages: Message[] = [mkUser("a"), mkUser("b"), mkUser("c")];
    const result = await compactMessages(messages, mockSummarize, 3);
    expect(result).toBe(messages);
  });

  it("compacts old messages and preserves recent ones", async () => {
    const messages: Message[] = [
      mkUser("old1"),
      mkUser("old2"),
      mkAssistant("old3"),
      mkUser("recent1"),
      mkAssistant("recent2"),
    ];
    const result = await compactMessages(messages, mockSummarize, 2);

    // Should have summary + 2 recent
    expect(result.length).toBe(3);
    expect(result[0].role).toBe("user");
    expect((result[0] as UserMessage).content).toContain("[Conversation summary]");
    expect((result[0] as UserMessage).content).toContain("This is a summary of old messages.");
  });

  it("preserves the recentCount most-recent messages", async () => {
    const messages: Message[] = [
      mkUser("old1"),
      mkUser("old2"),
      mkUser("recent1"),
      mkAssistant("recent2"),
      mkUser("recent3"),
    ];
    const result = await compactMessages(messages, mockSummarize, 3);

    // Last 3 messages preserved
    expect(result.length).toBe(4); // summary + 3 recent
    expect((result[1] as UserMessage).content).toBe("recent1");
    expect((result[3] as UserMessage).content).toBe("recent3");
  });

  it("calls summarize with old messages prompt", async () => {
    let receivedPrompt = "";
    const spy = async (prompt: string) => {
      receivedPrompt = prompt;
      return "summary";
    };

    const messages: Message[] = [
      mkUser("old message"),
      mkAssistant("old reply"),
      mkUser("recent"),
    ];
    await compactMessages(messages, spy, 1);

    expect(receivedPrompt).toContain("User: old message");
    expect(receivedPrompt).toContain("Assistant: old reply");
    // The recent message should NOT appear in the summarize prompt
    expect(receivedPrompt).not.toContain("User: recent");
  });

  it("summary message has role 'user'", async () => {
    const messages: Message[] = [mkUser("a"), mkUser("b"), mkUser("c")];
    const result = await compactMessages(messages, mockSummarize, 1);
    expect(result[0].role).toBe("user");
  });

  it("summary message content starts with '[Conversation summary]'", async () => {
    const messages: Message[] = [mkUser("a"), mkUser("b"), mkUser("c")];
    const result = await compactMessages(messages, mockSummarize, 1);
    expect((result[0] as UserMessage).content).toMatch(/^\[Conversation summary\]/);
  });

  it("uses default recentCount of 10 when not specified", async () => {
    const messages: Message[] = Array.from({ length: 12 }, (_, i) => mkUser(`msg-${i}`));
    const result = await compactMessages(messages, mockSummarize);
    // 12 messages, default recentCount=10 -> compact 2 old, keep 10 recent
    expect(result.length).toBe(11); // summary + 10 recent
  });

  it("does not compact when exactly at default recentCount", async () => {
    const messages: Message[] = Array.from({ length: 10 }, (_, i) => mkUser(`msg-${i}`));
    const result = await compactMessages(messages, mockSummarize);
    expect(result).toBe(messages);
  });
});

// ── truncateOversizedToolResults ─────────────────────────────────────

describe("truncateOversizedToolResults", () => {
  it("returns messages unchanged when all under maxChars", () => {
    const messages: Message[] = [
      mkUser("hello"),
      mkToolResult("bash", "short output"),
      mkAssistant("ok"),
    ];
    const result = truncateOversizedToolResults(messages, 1000);

    expect(result).toHaveLength(3);
    // Non-tool messages should be the exact same reference
    expect(result[0]).toBe(messages[0]);
    expect(result[1]).toBe(messages[1]);
    expect(result[2]).toBe(messages[2]);
  });

  it("truncates ToolResultMessage text content exceeding maxChars", () => {
    const longText = "a".repeat(200);
    const messages: Message[] = [mkToolResult("bash", longText)];
    const result = truncateOversizedToolResults(messages, 50);

    const toolMsg = result[0] as ToolResultMessage;
    const textContent = toolMsg.content[0] as TextContent;
    expect(textContent.text.length).toBeLessThan(longText.length);
    expect(textContent.text.startsWith("a".repeat(50))).toBe(true);
  });

  it("adds '[truncated N chars]' marker", () => {
    const longText = "b".repeat(300);
    const messages: Message[] = [mkToolResult("bash", longText)];
    const result = truncateOversizedToolResults(messages, 100);

    const toolMsg = result[0] as ToolResultMessage;
    const textContent = toolMsg.content[0] as TextContent;
    expect(textContent.text).toContain("[truncated 200 chars]");
  });

  it("does not modify non-tool messages", () => {
    const messages: Message[] = [
      mkUser("a".repeat(500)),
      mkAssistant("b".repeat(500)),
    ];
    const result = truncateOversizedToolResults(messages, 10);

    expect(result[0]).toBe(messages[0]);
    expect(result[1]).toBe(messages[1]);
  });

  it("returns a new array (no mutation of input)", () => {
    const longText = "x".repeat(200);
    const original: Message[] = [mkToolResult("bash", longText)];
    const originalContent = (original[0] as ToolResultMessage).content[0] as TextContent;
    const originalText = originalContent.text;

    const result = truncateOversizedToolResults(original, 50);

    // Input array not mutated
    expect(result).not.toBe(original);
    // Original message content unchanged
    expect(((original[0] as ToolResultMessage).content[0] as TextContent).text).toBe(originalText);
  });

  it("does not create a new object for tool messages under the limit", () => {
    const messages: Message[] = [mkToolResult("bash", "short")];
    const result = truncateOversizedToolResults(messages, 1000);
    expect(result[0]).toBe(messages[0]);
  });

  it("handles multiple tool messages, truncating only oversized ones", () => {
    const messages: Message[] = [
      mkToolResult("bash", "short"),
      mkToolResult("read_file", "c".repeat(500)),
      mkUser("hello"),
      mkToolResult("write_file", "d".repeat(500)),
    ];
    const result = truncateOversizedToolResults(messages, 100);

    // First tool message unchanged (under limit)
    expect(result[0]).toBe(messages[0]);

    // Second tool message truncated
    const tool2 = result[1] as ToolResultMessage;
    expect((tool2.content[0] as TextContent).text).toContain("[truncated 400 chars]");

    // User message unchanged
    expect(result[2]).toBe(messages[2]);

    // Third tool message truncated
    const tool3 = result[3] as ToolResultMessage;
    expect((tool3.content[0] as TextContent).text).toContain("[truncated 400 chars]");
  });

  it("preserves other ToolResultMessage fields after truncation", () => {
    const toolMsg = mkToolResult("bash", "x".repeat(200));
    const result = truncateOversizedToolResults([toolMsg], 50);

    const truncated = result[0] as ToolResultMessage;
    expect(truncated.role).toBe("toolResult");
    expect(truncated.toolCallId).toBe(toolMsg.toolCallId);
    expect(truncated.toolName).toBe("bash");
    expect(truncated.isError).toBe(false);
  });

  it("truncated text starts with exactly maxChars from original", () => {
    const original = "abcdefghij" + "k".repeat(100);
    const messages: Message[] = [mkToolResult("bash", original)];
    const result = truncateOversizedToolResults(messages, 10);

    const text = ((result[0] as ToolResultMessage).content[0] as TextContent).text;
    expect(text.startsWith("abcdefghij")).toBe(true);
    expect(text).toContain(`[truncated ${original.length - 10} chars]`);
  });
});
