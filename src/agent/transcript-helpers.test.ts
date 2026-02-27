import { describe, it, expect } from "vitest";

import type {
  AssistantMessage,
  UserMessage,
  ToolResultMessage,
  TextContent,
  ThinkingContent,
  ToolCall,
  Usage,
} from "@mariozechner/pi-ai";

import type { TranscriptMessage } from "../sessions/index.js";

import {
  transcriptToMessages,
  messagesToTranscript,
  repairOrphanedToolCalls,
  extractText,
  extractToolCalls,
} from "./transcript-helpers.js";

// ── Helpers ──────────────────────────────────────────────────────────

function emptyUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function makeAssistantMessage(
  content: AssistantMessage["content"],
  overrides?: Partial<Omit<AssistantMessage, "role" | "content">>,
): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "anthropic-messages",
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    usage: emptyUsage(),
    stopReason: "stop",
    timestamp: 2000,
    ...overrides,
  };
}

function makeToolCall(
  id: string,
  name: string,
  args: Record<string, any> = {},
): ToolCall {
  return { type: "toolCall", id, name, arguments: args };
}

function makeToolResult(
  toolCallId: string,
  toolName: string,
  text: string,
  overrides?: Partial<Omit<ToolResultMessage, "role">>,
): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId,
    toolName,
    content: [{ type: "text", text }],
    isError: false,
    timestamp: 3000,
    ...overrides,
  };
}

// ── transcriptToMessages ─────────────────────────────────────────────

describe("transcriptToMessages", () => {
  it("converts user transcript messages to UserMessage", () => {
    const transcript: TranscriptMessage[] = [
      { role: "user", content: "hi", ts: 123 },
    ];

    const messages = transcriptToMessages(transcript);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({
      role: "user",
      content: "hi",
      timestamp: 123,
    } satisfies UserMessage);
  });

  it("converts assistant transcript messages to AssistantMessage with TextContent", () => {
    const transcript: TranscriptMessage[] = [
      { role: "assistant", content: "Hello!", ts: 456 },
    ];

    const messages = transcriptToMessages(transcript);

    expect(messages).toHaveLength(1);
    const msg = messages[0] as AssistantMessage;
    expect(msg.role).toBe("assistant");
    expect(msg.content).toEqual([{ type: "text", text: "Hello!" }]);
    expect(msg.timestamp).toBe(456);
    // Defaults when no meta provided
    expect(msg.api).toBe("anthropic-messages");
    expect(msg.provider).toBe("anthropic");
    expect(msg.model).toBe("unknown");
    expect(msg.stopReason).toBe("stop");
    expect(msg.usage).toEqual(emptyUsage());
  });

  it("uses meta.contentBlocks for assistant messages when present", () => {
    const blocks: AssistantMessage["content"] = [
      { type: "text", text: "part1" },
      { type: "toolCall", id: "tc1", name: "read", arguments: { path: "." } },
    ];
    const transcript: TranscriptMessage[] = [
      {
        role: "assistant",
        content: "part1",
        ts: 789,
        meta: { contentBlocks: blocks },
      },
    ];

    const messages = transcriptToMessages(transcript);
    const msg = messages[0] as AssistantMessage;

    expect(msg.content).toBe(blocks);
    expect(msg.content).toHaveLength(2);
    expect(msg.content[0]).toEqual({ type: "text", text: "part1" });
    expect(msg.content[1]).toEqual({
      type: "toolCall",
      id: "tc1",
      name: "read",
      arguments: { path: "." },
    });
  });

  it("restores assistant meta fields (api, provider, model, usage, stopReason)", () => {
    const usage = emptyUsage();
    usage.input = 100;
    usage.output = 50;
    const transcript: TranscriptMessage[] = [
      {
        role: "assistant",
        content: "text",
        ts: 100,
        meta: {
          api: "openai-completions",
          provider: "openai",
          model: "gpt-4",
          usage,
          stopReason: "toolUse",
        },
      },
    ];

    const messages = transcriptToMessages(transcript);
    const msg = messages[0] as AssistantMessage;

    expect(msg.api).toBe("openai-completions");
    expect(msg.provider).toBe("openai");
    expect(msg.model).toBe("gpt-4");
    expect(msg.usage).toBe(usage);
    expect(msg.stopReason).toBe("toolUse");
  });

  it("converts tool transcript messages to ToolResultMessage", () => {
    const transcript: TranscriptMessage[] = [
      {
        role: "tool",
        content: "result text",
        ts: 300,
        toolCallId: "tc-42",
        meta: { toolName: "read_file" },
      },
    ];

    const messages = transcriptToMessages(transcript);

    expect(messages).toHaveLength(1);
    const msg = messages[0] as ToolResultMessage;
    expect(msg.role).toBe("toolResult");
    expect(msg.toolCallId).toBe("tc-42");
    expect(msg.toolName).toBe("read_file");
    expect(msg.content).toEqual([{ type: "text", text: "result text" }]);
    expect(msg.isError).toBe(false);
    expect(msg.timestamp).toBe(300);
  });

  it("uses meta.isError for tool messages", () => {
    const transcript: TranscriptMessage[] = [
      {
        role: "tool",
        content: "error occurred",
        ts: 400,
        toolCallId: "tc-99",
        meta: { toolName: "write_file", isError: true },
      },
    ];

    const messages = transcriptToMessages(transcript);
    const msg = messages[0] as ToolResultMessage;

    expect(msg.isError).toBe(true);
  });

  it("defaults toolCallId and toolName to 'unknown' when not provided", () => {
    const transcript: TranscriptMessage[] = [
      { role: "tool", content: "result", ts: 500 },
    ];

    const messages = transcriptToMessages(transcript);
    const msg = messages[0] as ToolResultMessage;

    expect(msg.toolCallId).toBe("unknown");
    expect(msg.toolName).toBe("unknown");
  });

  it("skips system messages", () => {
    const transcript: TranscriptMessage[] = [
      { role: "system", content: "You are a helpful assistant.", ts: 0 },
      { role: "user", content: "hi", ts: 1 },
    ];

    const messages = transcriptToMessages(transcript);

    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
  });

  it("returns empty array for empty transcript", () => {
    expect(transcriptToMessages([])).toEqual([]);
  });

  it("handles mixed message types in correct order", () => {
    const transcript: TranscriptMessage[] = [
      { role: "system", content: "sys", ts: 0 },
      { role: "user", content: "hello", ts: 1 },
      { role: "assistant", content: "hi", ts: 2 },
      { role: "tool", content: "result", ts: 3, toolCallId: "tc1", meta: { toolName: "test" } },
      { role: "user", content: "next", ts: 4 },
    ];

    const messages = transcriptToMessages(transcript);

    expect(messages).toHaveLength(4);
    expect(messages[0].role).toBe("user");
    expect(messages[1].role).toBe("assistant");
    expect(messages[2].role).toBe("toolResult");
    expect(messages[3].role).toBe("user");
  });
});

// ── messagesToTranscript ─────────────────────────────────────────────

describe("messagesToTranscript", () => {
  it("converts UserMessage with string content", () => {
    const messages: UserMessage[] = [
      { role: "user", content: "hello world", timestamp: 1000 },
    ];

    const transcript = messagesToTranscript(messages);

    expect(transcript).toHaveLength(1);
    expect(transcript[0]).toEqual({
      role: "user",
      content: "hello world",
      ts: 1000,
    });
  });

  it("converts UserMessage with array content (extracts text)", () => {
    const messages: UserMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "line1" },
          { type: "text", text: "line2" },
        ],
        timestamp: 1100,
      },
    ];

    const transcript = messagesToTranscript(messages);

    expect(transcript[0].content).toBe("line1\nline2");
    expect(transcript[0].ts).toBe(1100);
  });

  it("converts UserMessage with mixed content (filters out non-text)", () => {
    const messages: UserMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "text part" },
          { type: "image", data: "base64...", mimeType: "image/png" },
        ],
        timestamp: 1200,
      },
    ];

    const transcript = messagesToTranscript(messages);

    expect(transcript[0].content).toBe("text part");
  });

  it("converts AssistantMessage with text content and metadata", () => {
    const assistant = makeAssistantMessage(
      [{ type: "text", text: "answer" }],
      {
        api: "anthropic-messages",
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
        stopReason: "stop",
        timestamp: 2000,
      },
    );

    const transcript = messagesToTranscript([assistant]);

    expect(transcript).toHaveLength(1);
    expect(transcript[0].role).toBe("assistant");
    expect(transcript[0].content).toBe("answer");
    expect(transcript[0].ts).toBe(2000);
    expect(transcript[0].meta).toEqual({
      contentBlocks: assistant.content,
      api: "anthropic-messages",
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      usage: emptyUsage(),
      stopReason: "stop",
    });
  });

  it("preserves contentBlocks with tool calls in assistant meta", () => {
    const content: AssistantMessage["content"] = [
      { type: "text", text: "Let me read that." },
      makeToolCall("tc1", "read_file", { path: "/foo.ts" }),
    ];
    const assistant = makeAssistantMessage(content);

    const transcript = messagesToTranscript([assistant]);

    expect(transcript[0].content).toBe("Let me read that.");
    expect(transcript[0].meta!.contentBlocks).toBe(content);
  });

  it("converts ToolResultMessage", () => {
    const toolResult = makeToolResult("tc-42", "read_file", "file contents");

    const transcript = messagesToTranscript([toolResult]);

    expect(transcript).toHaveLength(1);
    expect(transcript[0]).toEqual({
      role: "tool",
      content: "file contents",
      ts: 3000,
      toolCallId: "tc-42",
      meta: {
        toolName: "read_file",
        isError: false,
      },
    });
  });

  it("converts ToolResultMessage with isError: true", () => {
    const toolResult = makeToolResult("tc-err", "write_file", "permission denied", {
      isError: true,
      timestamp: 5000,
    });

    const transcript = messagesToTranscript([toolResult]);

    expect(transcript[0].meta!.isError).toBe(true);
    expect(transcript[0].content).toBe("permission denied");
  });

  it("joins multiple TextContent blocks in ToolResultMessage", () => {
    const toolResult: ToolResultMessage = {
      role: "toolResult",
      toolCallId: "tc-multi",
      toolName: "search",
      content: [
        { type: "text", text: "result1" },
        { type: "text", text: "result2" },
      ],
      isError: false,
      timestamp: 6000,
    };

    const transcript = messagesToTranscript([toolResult]);

    expect(transcript[0].content).toBe("result1\nresult2");
  });

  it("returns empty array for empty messages", () => {
    expect(messagesToTranscript([])).toEqual([]);
  });
});

// ── Round-trip ───────────────────────────────────────────────────────

describe("round-trip (messagesToTranscript -> transcriptToMessages)", () => {
  it("round-trips user messages", () => {
    const original: UserMessage[] = [
      { role: "user", content: "hello", timestamp: 1000 },
    ];

    const transcript = messagesToTranscript(original);
    const restored = transcriptToMessages(transcript);

    expect(restored).toHaveLength(1);
    expect(restored[0]).toEqual(original[0]);
  });

  it("round-trips assistant messages preserving contentBlocks", () => {
    const content: AssistantMessage["content"] = [
      { type: "text", text: "I will help." },
      makeToolCall("tc1", "read_file", { path: "/a.ts" }),
    ];
    const original = makeAssistantMessage(content);

    const transcript = messagesToTranscript([original]);
    const restored = transcriptToMessages(transcript);

    expect(restored).toHaveLength(1);
    const msg = restored[0] as AssistantMessage;
    expect(msg.role).toBe("assistant");
    expect(msg.content).toEqual(content);
    expect(msg.timestamp).toBe(original.timestamp);
    expect(msg.api).toBe(original.api);
    expect(msg.provider).toBe(original.provider);
    expect(msg.model).toBe(original.model);
    expect(msg.stopReason).toBe(original.stopReason);
  });

  it("round-trips tool result messages", () => {
    const original = makeToolResult("tc-42", "read_file", "contents");

    const transcript = messagesToTranscript([original]);
    const restored = transcriptToMessages(transcript);

    expect(restored).toHaveLength(1);
    const msg = restored[0] as ToolResultMessage;
    expect(msg.role).toBe("toolResult");
    expect(msg.toolCallId).toBe("tc-42");
    expect(msg.toolName).toBe("read_file");
    expect(msg.content).toEqual([{ type: "text", text: "contents" }]);
    expect(msg.isError).toBe(false);
  });
});

// ── repairOrphanedToolCalls ──────────────────────────────────────────

describe("repairOrphanedToolCalls", () => {
  it("returns messages unchanged when no orphaned tool calls", () => {
    const messages = [
      { role: "user", content: "do something", timestamp: 1 } as UserMessage,
      makeAssistantMessage([
        { type: "text", text: "ok" },
        makeToolCall("tc1", "read_file", { path: "." }),
      ]),
      makeToolResult("tc1", "read_file", "file content"),
    ];

    const repaired = repairOrphanedToolCalls(messages);

    expect(repaired).toHaveLength(3);
    expect(repaired).toEqual(messages);
  });

  it("injects synthetic error for a single orphaned tool call", () => {
    const assistant = makeAssistantMessage([
      { type: "text", text: "calling tool" },
      makeToolCall("tc-orphan", "write_file", { path: "/x.ts", content: "..." }),
    ]);
    const messages = [
      { role: "user", content: "go", timestamp: 1 } as UserMessage,
      assistant,
    ];

    const repaired = repairOrphanedToolCalls(messages);

    expect(repaired).toHaveLength(3);
    const synthetic = repaired[2] as ToolResultMessage;
    expect(synthetic.role).toBe("toolResult");
    expect(synthetic.toolCallId).toBe("tc-orphan");
    expect(synthetic.toolName).toBe("write_file");
    expect(synthetic.isError).toBe(true);
    expect(synthetic.content).toEqual([
      { type: "text", text: "[Tool result missing \u2014 session was interrupted]" },
    ]);
    expect(synthetic.timestamp).toBe(assistant.timestamp);
  });

  it("injects synthetic errors for multiple orphaned tool calls in one message", () => {
    const assistant = makeAssistantMessage([
      makeToolCall("tc-a", "read_file", {}),
      makeToolCall("tc-b", "write_file", {}),
    ]);
    const messages = [
      { role: "user", content: "go", timestamp: 1 } as UserMessage,
      assistant,
    ];

    const repaired = repairOrphanedToolCalls(messages);

    // user + assistant + 2 synthetic results
    expect(repaired).toHaveLength(4);
    const syntheticA = repaired[2] as ToolResultMessage;
    const syntheticB = repaired[3] as ToolResultMessage;
    expect(syntheticA.toolCallId).toBe("tc-a");
    expect(syntheticA.toolName).toBe("read_file");
    expect(syntheticA.isError).toBe(true);
    expect(syntheticB.toolCallId).toBe("tc-b");
    expect(syntheticB.toolName).toBe("write_file");
    expect(syntheticB.isError).toBe(true);
  });

  it("does not inject if matching ToolResultMessage exists", () => {
    const assistant = makeAssistantMessage([
      makeToolCall("tc1", "read_file", {}),
      makeToolCall("tc2", "write_file", {}),
    ]);
    const messages = [
      { role: "user", content: "go", timestamp: 1 } as UserMessage,
      assistant,
      makeToolResult("tc1", "read_file", "ok"),
      makeToolResult("tc2", "write_file", "done"),
    ];

    const repaired = repairOrphanedToolCalls(messages);

    expect(repaired).toHaveLength(4);
    // No synthetic messages injected
    expect(repaired).toEqual(messages);
  });

  it("injects only for the missing tool call when some results exist", () => {
    const assistant = makeAssistantMessage([
      makeToolCall("tc1", "read_file", {}),
      makeToolCall("tc2", "write_file", {}),
    ]);
    const messages = [
      { role: "user", content: "go", timestamp: 1 } as UserMessage,
      assistant,
      makeToolResult("tc1", "read_file", "ok"),
      // tc2 is orphaned
    ];

    const repaired = repairOrphanedToolCalls(messages);

    expect(repaired).toHaveLength(4);
    // Synthetic injected right after assistant, before existing tc1 result
    const synthetic = repaired[2] as ToolResultMessage;
    expect(synthetic.toolCallId).toBe("tc2");
    expect(synthetic.toolName).toBe("write_file");
    expect(synthetic.isError).toBe(true);
    // Original tc1 result preserved
    const tc1Result = repaired[3] as ToolResultMessage;
    expect(tc1Result.toolCallId).toBe("tc1");
  });

  it("handles assistant messages without tool calls (no injection)", () => {
    const messages = [
      { role: "user", content: "hi", timestamp: 1 } as UserMessage,
      makeAssistantMessage([{ type: "text", text: "hello" }]),
    ];

    const repaired = repairOrphanedToolCalls(messages);

    expect(repaired).toHaveLength(2);
    expect(repaired).toEqual(messages);
  });

  it("returns empty array for empty input", () => {
    expect(repairOrphanedToolCalls([])).toEqual([]);
  });

  it("stops looking for results at the next assistant message boundary", () => {
    // Assistant1 has tc1, then immediately another assistant message follows
    // without a result for tc1 => tc1 is orphaned
    const assistant1 = makeAssistantMessage(
      [makeToolCall("tc1", "tool_a", {})],
      { timestamp: 100 },
    );
    const assistant2 = makeAssistantMessage(
      [{ type: "text", text: "next turn" }],
      { timestamp: 200 },
    );
    const messages = [
      { role: "user", content: "go", timestamp: 1 } as UserMessage,
      assistant1,
      assistant2,
    ];

    const repaired = repairOrphanedToolCalls(messages);

    // user + assistant1 + synthetic(tc1) + assistant2
    expect(repaired).toHaveLength(4);
    const synthetic = repaired[2] as ToolResultMessage;
    expect(synthetic.toolCallId).toBe("tc1");
    expect(synthetic.isError).toBe(true);
    expect(synthetic.timestamp).toBe(100);
  });

  it("handles multiple assistant messages each with orphaned calls", () => {
    const a1 = makeAssistantMessage(
      [makeToolCall("tc1", "tool_a", {})],
      { timestamp: 100 },
    );
    const a2 = makeAssistantMessage(
      [makeToolCall("tc2", "tool_b", {})],
      { timestamp: 200 },
    );
    const messages = [
      { role: "user", content: "go", timestamp: 1 } as UserMessage,
      a1,
      a2,
    ];

    const repaired = repairOrphanedToolCalls(messages);

    // user + a1 + synthetic(tc1) + a2 + synthetic(tc2)
    expect(repaired).toHaveLength(5);
    expect((repaired[2] as ToolResultMessage).toolCallId).toBe("tc1");
    expect((repaired[2] as ToolResultMessage).isError).toBe(true);
    expect((repaired[4] as ToolResultMessage).toolCallId).toBe("tc2");
    expect((repaired[4] as ToolResultMessage).isError).toBe(true);
  });
});

// ── extractText ──────────────────────────────────────────────────────

describe("extractText", () => {
  it("extracts and concatenates text from TextContent blocks", () => {
    const msg = makeAssistantMessage([
      { type: "text", text: "Hello " },
      { type: "text", text: "World" },
    ]);

    expect(extractText(msg)).toBe("Hello World");
  });

  it("returns empty string if no TextContent", () => {
    const msg = makeAssistantMessage([
      makeToolCall("tc1", "tool", {}),
    ]);

    expect(extractText(msg)).toBe("");
  });

  it("ignores ThinkingContent blocks", () => {
    const msg = makeAssistantMessage([
      { type: "thinking", thinking: "let me think..." } satisfies ThinkingContent,
      { type: "text", text: "Answer" },
    ]);

    expect(extractText(msg)).toBe("Answer");
  });

  it("ignores ToolCall blocks", () => {
    const msg = makeAssistantMessage([
      { type: "text", text: "before " },
      makeToolCall("tc1", "tool", {}),
      { type: "text", text: "after" },
    ]);

    expect(extractText(msg)).toBe("before after");
  });

  it("returns empty string for empty content array", () => {
    const msg = makeAssistantMessage([]);

    expect(extractText(msg)).toBe("");
  });
});

// ── extractToolCalls ─────────────────────────────────────────────────

describe("extractToolCalls", () => {
  it("extracts ToolCall items from content", () => {
    const tc1 = makeToolCall("tc1", "read_file", { path: "/a" });
    const tc2 = makeToolCall("tc2", "write_file", { path: "/b", content: "x" });
    const msg = makeAssistantMessage([
      { type: "text", text: "I will use tools." },
      tc1,
      tc2,
    ]);

    const calls = extractToolCalls(msg);

    expect(calls).toHaveLength(2);
    expect(calls[0]).toBe(tc1);
    expect(calls[1]).toBe(tc2);
  });

  it("returns empty array if no ToolCall items", () => {
    const msg = makeAssistantMessage([
      { type: "text", text: "no tools" },
    ]);

    expect(extractToolCalls(msg)).toEqual([]);
  });

  it("filters out TextContent and ThinkingContent", () => {
    const tc = makeToolCall("tc1", "tool", {});
    const msg = makeAssistantMessage([
      { type: "thinking", thinking: "hmm" } satisfies ThinkingContent,
      { type: "text", text: "text" },
      tc,
    ]);

    const calls = extractToolCalls(msg);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe(tc);
  });

  it("returns empty array for empty content", () => {
    const msg = makeAssistantMessage([]);

    expect(extractToolCalls(msg)).toEqual([]);
  });
});
