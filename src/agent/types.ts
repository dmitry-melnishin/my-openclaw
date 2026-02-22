/**
 * Core types for the agent engine.
 *
 * Re-exports Pi SDK types and defines MyClaw-specific types
 * (RunResult, FailoverReason) that the SDK doesn't cover.
 */

// ── Pi SDK re-exports ───────────────────────────────────────────────

export type {
  AgentTool,
  AgentToolResult,
  AgentToolUpdateCallback,
  AgentMessage,
  AgentEvent,
  ThinkingLevel,
  StreamFn,
} from "@mariozechner/pi-agent-core";

export type {
  AssistantMessage,
  AssistantMessageEvent,
  UserMessage,
  ToolResultMessage,
  Message,
  ToolCall,
  TextContent,
  ImageContent,
  ThinkingContent,
  Usage,
  StopReason,
  Model,
  Api,
  Tool,
  Context,
  SimpleStreamOptions,
} from "@mariozechner/pi-ai";

export { Type } from "@mariozechner/pi-ai";
export type { Static, TSchema } from "@mariozechner/pi-ai";

// ── MyClaw-specific types ───────────────────────────────────────────

import type {
  AssistantMessage as _AssistantMessage,
  TextContent as _TextContent,
  ToolCall as _ToolCall,
  Usage as _Usage,
} from "@mariozechner/pi-ai";

/**
 * Result of a single agent run.
 */
export interface RunResult {
  /** Final text reply from the assistant. */
  reply: string;
  /** Accumulated usage across all LLM calls in the run. */
  usage: _Usage;
  /** Number of tool-call iterations executed. */
  iterations: number;
  /** Whether the run hit the max iteration limit. */
  maxIterationsReached: boolean;
  /** Error details if the run failed. */
  error?: { kind: string; message: string };
}

/**
 * Reason for auth profile failover.
 */
export type FailoverReason =
  | "auth"
  | "rate_limit"
  | "billing"
  | "timeout"
  | "quota"
  | "unknown";

// ── Usage helpers ───────────────────────────────────────────────────

/** Create a zero-valued Usage object. */
export function emptyUsage(): _Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

/** Accumulate usage from a new LLM response into a running total. */
export function addUsage(acc: _Usage, delta: _Usage): _Usage {
  return {
    input: acc.input + delta.input,
    output: acc.output + delta.output,
    cacheRead: acc.cacheRead + delta.cacheRead,
    cacheWrite: acc.cacheWrite + delta.cacheWrite,
    totalTokens: acc.totalTokens + delta.totalTokens,
    cost: {
      input: acc.cost.input + delta.cost.input,
      output: acc.cost.output + delta.cost.output,
      cacheRead: acc.cost.cacheRead + delta.cost.cacheRead,
      cacheWrite: acc.cost.cacheWrite + delta.cost.cacheWrite,
      total: acc.cost.total + delta.cost.total,
    },
  };
}

// ── Message helpers ─────────────────────────────────────────────────

/**
 * Extract plain text content from an AssistantMessage.
 */
export function getAssistantText(msg: _AssistantMessage): string {
  return msg.content
    .filter((c): c is _TextContent => c.type === "text")
    .map((c) => c.text)
    .join("");
}

/**
 * Extract tool calls from an AssistantMessage.
 */
export function getToolCalls(msg: _AssistantMessage): _ToolCall[] {
  return msg.content.filter((c): c is _ToolCall => c.type === "toolCall");
}
