/**
 * Context window overflow detection and message compaction.
 *
 * Detects context overflow errors from LLM API responses and compacts
 * conversation history by summarising old messages to free token space.
 *
 * Uses Pi SDK Message types (UserMessage, AssistantMessage, ToolResultMessage).
 */

import type {
  Message,
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  TextContent,
  ToolCall,
} from "@mariozechner/pi-ai";
import { getAssistantText, getToolCalls } from "./types.js";

// ── Constants ───────────────────────────────────────────────────────

/** Default number of recent messages to keep intact during compaction. */
export const COMPACT_KEEP_RECENT = 10;

/** Max characters for a single tool result before truncation. */
export const MAX_TOOL_RESULT_CHARS = 50_000;

/** Truncation suffix appended when a tool result is clipped. */
const TRUNCATION_SUFFIX = "\n\n... [output truncated]";

// ── Context overflow detection ──────────────────────────────────────

/**
 * Regex patterns that LLM providers use to signal context overflow.
 */
const CONTEXT_OVERFLOW_PATTERNS = [
  /context.*(length|window|overflow|too long)/i,
  /maximum.*tokens/i,
  /prompt.*too.*long/i,
  /request.*too.*large/i,
  /exceeds.*model.*context/i,
  /input.*too.*long/i,
  /max.*context/i,
  /token.*limit.*exceeded/i,
  /content.*length.*exceeded/i,
  /payload.*too.*large/i,
];

/**
 * Detect whether an error is a context window overflow.
 */
export function isContextOverflowError(err: unknown): boolean {
  const status = (err as Record<string, unknown>)?.status;
  if (status === 413) return true;

  const msg = err instanceof Error ? err.message : String(err);

  for (const pattern of CONTEXT_OVERFLOW_PATTERNS) {
    if (pattern.test(msg)) return true;
  }

  return false;
}

// ── Tool result truncation ──────────────────────────────────────────

/**
 * Truncate a tool result string if it exceeds `maxChars`.
 */
export function truncateToolResult(
  result: string,
  maxChars: number = MAX_TOOL_RESULT_CHARS,
): string {
  if (result.length <= maxChars) return result;

  const cutTarget = maxChars - TRUNCATION_SUFFIX.length;
  const searchStart = Math.max(0, cutTarget - Math.floor(cutTarget * 0.1));
  const lastNewline = result.lastIndexOf("\n", cutTarget);

  const cutPoint = lastNewline > searchStart ? lastNewline : cutTarget;
  return result.slice(0, cutPoint) + TRUNCATION_SUFFIX;
}

// ── Message helpers ─────────────────────────────────────────────────

/** Extract text from any Pi SDK message. */
function getMessageText(msg: Message): string {
  if (msg.role === "user") {
    const user = msg as UserMessage;
    if (typeof user.content === "string") return user.content;
    return (user.content as (TextContent | { type: string })[])
      .filter((c): c is TextContent => c.type === "text")
      .map((c) => c.text)
      .join("");
  }
  if (msg.role === "assistant") {
    return getAssistantText(msg as AssistantMessage);
  }
  // toolResult
  const tr = msg as ToolResultMessage;
  return tr.content
    .filter((c): c is TextContent => c.type === "text")
    .map((c) => c.text)
    .join("");
}

// ── Message formatting helper ───────────────────────────────────────

/**
 * Format messages into a plain-text summary suitable for an LLM to
 * summarise. Strips tool-call details and metadata.
 */
export function formatMessagesForSummary(messages: Message[]): string {
  const lines: string[] = [];

  for (const msg of messages) {
    if (msg.role === "user") {
      const text = getMessageText(msg);
      lines.push(`User: ${text}`);
    } else if (msg.role === "assistant") {
      const assistantMsg = msg as AssistantMessage;
      const toolCalls = getToolCalls(assistantMsg);
      const text = getAssistantText(assistantMsg);

      if (toolCalls.length > 0) {
        const toolNames = toolCalls.map((tc) => tc.name).join(", ");
        lines.push(`Assistant: [called tools: ${toolNames}]`);
        if (text) lines.push(`Assistant: ${text}`);
      } else {
        lines.push(`Assistant: ${text}`);
      }
    } else {
      // toolResult
      const text = getMessageText(msg);
      const abbreviated =
        text.length > 500 ? text.slice(0, 500) + "..." : text;
      lines.push(`[Tool result]: ${abbreviated}`);
    }
  }

  return lines.join("\n");
}

// ── Message compaction ──────────────────────────────────────────────

/**
 * Callback type for calling the LLM during compaction.
 */
export type CompactLLMCall = (params: {
  model: string;
  apiKey: string;
  provider: string;
  baseUrl?: string;
  messages: Message[];
}) => Promise<{ content: string }>;

/**
 * Compact conversation messages by summarising old history.
 *
 * Keeps the most recent `keepRecent` messages intact and asks the LLM
 * to produce a concise summary of everything before that point.
 *
 * @returns A new messages array starting with a user context message
 *          followed by the preserved recent messages.
 */
export async function compactMessages(
  messages: Message[],
  callLLM: CompactLLMCall,
  config: {
    model: string;
    apiKey: string;
    provider: string;
    baseUrl?: string;
  },
  keepRecent: number = COMPACT_KEEP_RECENT,
): Promise<Message[]> {
  if (messages.length <= keepRecent) return messages;

  const old = messages.slice(0, -keepRecent);
  const recent = messages.slice(-keepRecent);

  const formattedHistory = formatMessagesForSummary(old);

  const summaryRequest: UserMessage = {
    role: "user",
    content: [
      "Summarize this conversation history concisely. Focus on:",
      "- Key decisions made",
      "- Important facts/context established",
      "- Current state of any tasks",
      "- File paths or code structures discussed",
      "",
      "Conversation:",
      formattedHistory,
    ].join("\n"),
    timestamp: Date.now(),
  };

  const summaryResponse = await callLLM({
    model: config.model,
    apiKey: config.apiKey,
    provider: config.provider,
    baseUrl: config.baseUrl,
    messages: [summaryRequest],
  });

  // Inject the summary as a user message at the start of the compacted history
  const summaryMsg: UserMessage = {
    role: "user",
    content: `[Previous conversation summary]:\n${summaryResponse.content}`,
    timestamp: Date.now(),
  };

  return [summaryMsg, ...recent];
}
