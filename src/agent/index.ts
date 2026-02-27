/**
 * Agent engine — public API.
 *
 * @example
 * ```ts
 * import { runAgent } from "./agent/index.js";
 *
 * const result = await runAgent({
 *   sessionKey: "agent:main:channel:cli:account:default:peer:direct:user",
 *   userMessage: "Hello!",
 *   config,
 *   onEvent: (e) => console.log(e.type),
 * });
 * console.log(result.reply);
 * ```
 */

export { runAgent } from "./run.js";

export type {
  RunAgentParams,
  RunResult,
  AgentRunEvent,
  AgentEventCallback,
  FailoverReason,
  ProfileState,
  CallLLMParams,
  BootstrapFile,
  StreamCallback,
} from "./types.js";

export {
  DEFAULT_BOOTSTRAP_MAX_CHARS_PER_FILE,
  DEFAULT_BOOTSTRAP_TOTAL_MAX_CHARS,
  COMPACTION_SAFETY_MARGIN,
  BASE_COOLDOWN_MS,
  MAX_COOLDOWN_MS,
  DEFAULT_COMPACTION_RECENT_COUNT,
  DEFAULT_MAX_TOOL_RESULT_TRUNCATE_CHARS,
} from "./types.js";

export { ensureWorkspace, scaffoldBootstrapFiles } from "./workspace.js";

export {
  BOOTSTRAP_FILENAMES,
  loadBootstrapFiles,
  type LoadBootstrapFilesOptions,
} from "./bootstrap-files.js";

export { buildSystemPrompt, type BuildSystemPromptOptions } from "./system-prompt.js";

export {
  classifyError,
  isRetriable,
  nextProfileIndex,
  createProfileStates,
  isProfileCoolingDown,
  markProfileFailed,
  markProfileGood,
} from "./failover.js";

export {
  detectContextOverflow,
  compactMessages,
  truncateOversizedToolResults,
  buildCompactionPrompt,
  type SummarizeFunction,
} from "./context-guard.js";

export { resolveModel, streamLLM, callLLM } from "./streaming.js";

export {
  transcriptToMessages,
  messagesToTranscript,
  repairOrphanedToolCalls,
  extractText,
  extractToolCalls,
} from "./transcript-helpers.js";

export { createApplyPatchTool } from "./tools/apply-patch.js";
export { createAgentTools, findTool, getToolNames } from "./tools/create-tools.js";
