/**
 * Context-window overflow detection and 3-level recovery.
 *
 * Level 1: Compact old messages via LLM summary
 * Level 2: Truncate oversized tool results
 * Level 3: Give up (throw)
 *
 * Ref: openclaw/src/agents/pi-embedded-runner/compact.ts,
 *      openclaw/src/agents/context-window-guard.ts
 */

import type { Message, UserMessage, ToolResultMessage, TextContent } from "@mariozechner/pi-ai";
import { COMPACTION_SAFETY_MARGIN, DEFAULT_MAX_TOOL_RESULT_TRUNCATE_CHARS } from "./types.js";

// ── Overflow detection ───────────────────────────────────────────────

const OVERFLOW_PATTERNS = [
  "context_length_exceeded",
  "context window",
  "context length",
  "maximum context",
  "token limit",
  "too many tokens",
  "prompt is too long",
  "request too large",
  "max_tokens",
  "maximum number of tokens",
];

/**
 * Detect whether an error (or its message) indicates context-window overflow.
 */
export function detectContextOverflow(errorOrMessage: unknown): boolean {
  let msg = "";
  if (typeof errorOrMessage === "string") {
    msg = errorOrMessage.toLowerCase();
  } else if (errorOrMessage && typeof errorOrMessage === "object") {
    const e = errorOrMessage as Record<string, unknown>;
    if (typeof e.message === "string") msg = e.message.toLowerCase();
    else if (typeof e.errorMessage === "string") msg = e.errorMessage.toLowerCase();
    else msg = String(errorOrMessage).toLowerCase();
  }

  return OVERFLOW_PATTERNS.some((p) => msg.includes(p));
}

// ── Level 1: Compact messages ────────────────────────────────────────

/**
 * Callback type for the LLM summariser used by compaction.
 * Receives a prompt asking to summarize the old messages and returns a summary string.
 */
export type SummarizeFunction = (prompt: string) => Promise<string>;

/**
 * Build a text prompt asking the LLM to summarize old messages.
 */
export function buildCompactionPrompt(messages: Message[]): string {
  const lines: string[] = [];
  lines.push("Summarize the following conversation concisely, preserving key facts, decisions, and any pending tasks:\n");

  for (const msg of messages) {
    if (msg.role === "user") {
      const text = typeof msg.content === "string" ? msg.content : "[complex content]";
      lines.push(`User: ${text}`);
    } else if (msg.role === "assistant") {
      const textParts = msg.content
        .filter((c): c is TextContent => c.type === "text")
        .map((c) => c.text);
      lines.push(`Assistant: ${textParts.join(" ")}`);
    } else if (msg.role === "toolResult") {
      const textParts = msg.content
        .filter((c): c is TextContent => c.type === "text")
        .map((c) => c.text);
      lines.push(`Tool (${msg.toolName}): ${textParts.join(" ").slice(0, 500)}`);
    }
  }

  lines.push("\nProvide a concise summary (1-3 paragraphs):");
  return lines.join("\n");
}

/**
 * Level 1 compaction: split messages into old + recent, summarize old via LLM,
 * return `[summaryUserMsg, ...recent]`.
 *
 * The `recentCount` most-recent messages are preserved as-is.
 * Safety margin: we note that token estimates can be ~20% off.
 */
export async function compactMessages(
  messages: Message[],
  summarize: SummarizeFunction,
  recentCount: number = 10,
): Promise<Message[]> {
  if (messages.length <= recentCount) {
    // Nothing to compact
    return messages;
  }

  const splitIndex = messages.length - recentCount;
  const oldMessages = messages.slice(0, splitIndex);
  const recentMessages = messages.slice(splitIndex);

  const prompt = buildCompactionPrompt(oldMessages);
  const summary = await summarize(prompt);

  // Pad summary to account for safety margin (the estimate that triggered
  // compaction may have been ~20% off, so the summary should be conservative)
  const summaryMsg: UserMessage = {
    role: "user",
    content: `[Conversation summary]\n${summary}`,
    timestamp: Date.now(),
  };

  return [summaryMsg, ...recentMessages];
}

// ── Level 2: Truncate oversized tool results ─────────────────────────

/**
 * Find tool-result messages with text content exceeding `maxChars` and
 * replace their content with a truncated version + marker.
 *
 * Returns a new array (no mutation of input).
 */
export function truncateOversizedToolResults(
  messages: Message[],
  maxChars: number = DEFAULT_MAX_TOOL_RESULT_TRUNCATE_CHARS,
): Message[] {
  return messages.map((msg) => {
    if (msg.role !== "toolResult") return msg;

    const toolMsg = msg as ToolResultMessage;
    let changed = false;
    const newContent = toolMsg.content.map((c) => {
      if (c.type !== "text") return c;
      if (c.text.length <= maxChars) return c;
      changed = true;
      return {
        ...c,
        text: c.text.slice(0, maxChars) + `\n[truncated ${c.text.length - maxChars} chars]`,
      };
    });

    if (!changed) return msg;

    return {
      ...toolMsg,
      content: newContent,
    } as ToolResultMessage;
  });
}
