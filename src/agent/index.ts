/**
 * Agent engine — public API.
 *
 * @example
 * ```ts
 * import { runAgent } from "./agent/index.js";
 * import { loadConfig } from "./config/index.js";
 * import { buildSessionKey } from "./sessions/index.js";
 *
 * const { config } = loadConfig();
 * const sessionKey = buildSessionKey({
 *   channel: "cli",
 *   peerKind: "direct",
 *   peerId: "user_local",
 * });
 *
 * const result = await runAgent({
 *   sessionKey,
 *   userMessage: "Hello!",
 *   config,
 * });
 *
 * console.log(result.reply);
 * ```
 */

// ── Run loop ────────────────────────────────────────────────────────

export { runAgent, type RunAgentParams } from "./run.js";

// ── Types ───────────────────────────────────────────────────────────

export type {
  // Pi SDK re-exports
  AgentTool,
  AgentToolResult,
  AgentMessage,
  AgentEvent,
  Message,
  UserMessage,
  AssistantMessage,
  AssistantMessageEvent,
  ToolResultMessage,
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
  ThinkingLevel,
  // MyClaw-specific
  RunResult,
  FailoverReason,
} from "./types.js";

export {
  Type,
  emptyUsage,
  addUsage,
  getAssistantText,
  getToolCalls,
} from "./types.js";

// ── Subsystems ──────────────────────────────────────────────────────

export { callLLM, streamLLM, resolveModel, type CallLLMParams, type StreamCallback } from "./streaming.js";
export { buildSystemPrompt, type SystemPromptParams } from "./system-prompt.js";
export {
  loadBootstrapFiles,
  formatBootstrapFiles,
  tryReadFile,
  BOOTSTRAP_FILES,
  type BootstrapFile,
} from "./bootstrap-files.js";
export {
  isContextOverflowError,
  compactMessages,
  truncateToolResult,
  formatMessagesForSummary,
  COMPACT_KEEP_RECENT,
  MAX_TOOL_RESULT_CHARS,
} from "./context-guard.js";
export {
  classifyFailoverReason,
  isRetriableFailoverReason,
  FailoverError,
} from "./failover.js";
export {
  resolveWorkspace,
  ensureWorkspace,
  isInsideWorkspace,
  resolveWorkspacePath,
} from "./workspace.js";
export { createTools, executeTool, getToolResultText } from "./tools/index.js";
