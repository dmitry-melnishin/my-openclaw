/**
 * Shared types for the agent engine.
 *
 * Every agent module imports from here to avoid circular deps.
 */

import type {
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  Model,
  SimpleStreamOptions,
  Usage,
} from "@mariozechner/pi-ai";

import type { MyClawConfig } from "../config/index.js";

// ── Constants ────────────────────────────────────────────────────────

export const DEFAULT_BOOTSTRAP_MAX_CHARS_PER_FILE = 50_000;
export const DEFAULT_BOOTSTRAP_TOTAL_MAX_CHARS = 200_000;
export const COMPACTION_SAFETY_MARGIN = 1.2;
export const BASE_COOLDOWN_MS = 1_000;
export const MAX_COOLDOWN_MS = 60_000;
export const DEFAULT_COMPACTION_RECENT_COUNT = 10;
export const DEFAULT_MAX_TOOL_RESULT_TRUNCATE_CHARS = 20_000;

// ── Bootstrap ────────────────────────────────────────────────────────

export interface BootstrapFile {
  name: string;
  content: string;
}

// ── Failover ─────────────────────────────────────────────────────────

export type FailoverReason =
  | "auth"
  | "rate_limit"
  | "billing"
  | "timeout"
  | "quota"
  | "context_overflow"
  | "unknown";

/** Per-run state for an auth profile (not persisted). */
export interface ProfileState {
  index: number;
  failedAt?: number;
  cooldownMs: number;
}

// ── Streaming / LLM calls ────────────────────────────────────────────

export type StreamCallback = (event: AssistantMessageEvent) => void;

export interface CallLLMParams {
  model: Model<any>;
  context: Context;
  options?: SimpleStreamOptions;
}

// ── Run loop events ──────────────────────────────────────────────────

export type AgentRunEvent =
  | { type: "llm_start"; iteration: number }
  | { type: "llm_stream"; event: AssistantMessageEvent }
  | { type: "llm_end"; message: AssistantMessage }
  | { type: "tool_start"; toolName: string; toolCallId: string }
  | {
      type: "tool_end";
      toolName: string;
      toolCallId: string;
      durationMs: number;
      isError: boolean;
    }
  | { type: "retry"; attempt: number; reason: FailoverReason; profileId: string }
  | { type: "compaction"; oldCount: number; newCount: number }
  | { type: "done"; result: RunResult };

export type AgentEventCallback = (event: AgentRunEvent) => void;

// ── Run params & result ──────────────────────────────────────────────

export interface RunAgentParams {
  sessionKey: string;
  userMessage: string;
  config: MyClawConfig;
  signal?: AbortSignal;
  onEvent?: AgentEventCallback;
}

export interface RunResult {
  /** Final assistant text reply. */
  reply: string;
  /** Accumulated usage across all LLM calls in this run. */
  usage: Usage;
  /** Usage from the last LLM call only (for context-size display). */
  lastCallUsage: Usage;
  /** Number of tool-call loop iterations completed. */
  iterations: number;
  /** Whether the loop was stopped because maxIterations was reached. */
  maxIterationsReached: boolean;
}
