/**
 * Main agent run loop.
 *
 * Orchestrates: workspace setup → tools → system prompt → history load →
 * LLM call loop with retry/failover/context compaction → tool execution →
 * transcript persistence.
 *
 * Uses Pi SDK's `streamSimple` / `completeSimple` (not the Agent class)
 * for full control over retry, failover, and compaction.
 *
 * Ref: openclaw/src/agents/pi-embedded-runner/run.ts
 */

import type {
  Message,
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  Context,
  TextContent,
  Usage,
} from "@mariozechner/pi-ai";

import {
  DEFAULT_MAX_ITERATIONS,
  DEFAULT_MAX_RETRIES,
  DEFAULT_MAX_TOOL_RESULT_CHARS,
} from "../config/index.js";
import { loadTranscript, appendMessages, updateSessionMeta } from "../sessions/index.js";

import type { RunAgentParams, RunResult, AgentEventCallback, ProfileState } from "./types.js";
import { ensureWorkspace, scaffoldBootstrapFiles } from "./workspace.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { resolveModel, streamLLM, callLLM } from "./streaming.js";
import { createAgentTools, findTool, getToolNames } from "./tools/create-tools.js";
import {
  transcriptToMessages,
  repairOrphanedToolCalls,
  messagesToTranscript,
  extractText,
  extractToolCalls,
} from "./transcript-helpers.js";
import {
  classifyError,
  isRetriable,
  nextProfileIndex,
  createProfileStates,
  isProfileCoolingDown,
  markProfileFailed,
  markProfileGood,
} from "./failover.js";
import {
  detectContextOverflow,
  compactMessages,
  truncateOversizedToolResults,
} from "./context-guard.js";

// ── Usage helpers ────────────────────────────────────────────────────

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

/**
 * Merge usage: sum input/output tokens and costs.
 * Cache tokens are NOT summed — each round-trip reports cache ≈ full context.
 */
function mergeUsage(accumulated: Usage, latest: Usage): Usage {
  return {
    input: accumulated.input + latest.input,
    output: accumulated.output + latest.output,
    // Cache fields: keep latest (not summed)
    cacheRead: latest.cacheRead,
    cacheWrite: latest.cacheWrite,
    totalTokens: accumulated.totalTokens + latest.totalTokens,
    cost: {
      input: accumulated.cost.input + latest.cost.input,
      output: accumulated.cost.output + latest.cost.output,
      cacheRead: latest.cost.cacheRead,
      cacheWrite: latest.cost.cacheWrite,
      total: accumulated.cost.total + latest.cost.total,
    },
  };
}

// ── Tool result helpers ──────────────────────────────────────────────

function extractToolResultText(result: { content: { type: string; text?: string }[] }): string {
  return result.content
    .filter((c): c is TextContent => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text)
    .join("\n");
}

function truncateToolResult(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n[truncated]";
}

// ── Main entry point ─────────────────────────────────────────────────

/**
 * Run the agent for a single user message.
 *
 * Pipeline:
 *   1. Setup workspace, tools, system prompt, model
 *   2. Load & prepare conversation history
 *   3. Iteration loop: LLM call → tool execution → repeat
 *   4. Persist new messages to transcript
 */
export async function runAgent(params: RunAgentParams): Promise<RunResult> {
  const { sessionKey, userMessage, config, signal, onEvent } = params;
  const emit = onEvent ?? (() => {});

  // ── 1. Setup ───────────────────────────────────────────────────────

  const workspaceDir = ensureWorkspace(config);
  scaffoldBootstrapFiles(workspaceDir);

  const tools = createAgentTools(workspaceDir);
  const toolNames = getToolNames(tools);

  const systemPrompt = buildSystemPrompt({
    workspaceDir,
    toolNames,
    modelId: config.provider.model,
  });

  const model = resolveModel(
    config.provider.name,
    config.provider.model,
    config.provider.baseUrl,
  );

  const maxIterations = config.agent?.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const maxRetries = config.agent?.maxRetries ?? DEFAULT_MAX_RETRIES;
  const maxToolResultChars = config.agent?.maxToolResultChars ?? DEFAULT_MAX_TOOL_RESULT_CHARS;

  // ── 2. Load & prepare history ──────────────────────────────────────

  const transcript = loadTranscript(sessionKey);
  let messages: Message[] = transcriptToMessages(transcript);
  messages = repairOrphanedToolCalls(messages);

  // Append new user message
  const userMsg: UserMessage = {
    role: "user",
    content: userMessage,
    timestamp: Date.now(),
  };
  messages.push(userMsg);

  // Track where new messages start (for persistence later)
  const historyLength = messages.length;

  // ── 3. Init profile state & usage ──────────────────────────────────

  const profileStates = createProfileStates(config.provider.authProfiles.length);
  let currentProfileIndex = 0;

  let totalUsage = emptyUsage();
  let lastCallUsage = emptyUsage();

  // ── 4. Iteration loop ──────────────────────────────────────────────

  let compactionAttempted = false;
  let truncationAttempted = false;
  let iterations = 0;

  for (iterations = 0; iterations < maxIterations; iterations++) {
    signal?.throwIfAborted();

    // ── 4a. Call LLM with retry loop ─────────────────────────────────

    let assistantMsg: AssistantMessage | undefined;
    let retries = 0;

    while (retries <= maxRetries) {
      signal?.throwIfAborted();

      // Find a non-cooling-down profile
      const profile = findAvailableProfile(
        profileStates,
        currentProfileIndex,
        config.provider.authProfiles.length,
      );
      if (profile === undefined) {
        // All profiles cooling down — wait for the shortest cooldown
        const minWait = Math.min(
          ...profileStates.map((s) =>
            s.failedAt !== undefined ? s.cooldownMs - (Date.now() - s.failedAt) : 0,
          ),
        );
        await sleep(Math.max(minWait, 100), signal);
        retries++;
        continue;
      }
      currentProfileIndex = profile.index;

      const apiKey = config.provider.authProfiles[currentProfileIndex].apiKey;
      const context: Context = {
        systemPrompt,
        messages,
        tools,
      };

      emit({ type: "llm_start", iteration: iterations });

      try {
        const callParams = {
          model,
          context,
          options: { apiKey, signal },
        };

        if (onEvent) {
          assistantMsg = await streamLLM(callParams, onEvent);
        } else {
          assistantMsg = await callLLM(callParams);
        }

        // Success
        markProfileGood(profileStates[currentProfileIndex]);
        lastCallUsage = assistantMsg.usage;
        totalUsage = mergeUsage(totalUsage, lastCallUsage);

        emit({ type: "llm_end", message: assistantMsg });
        break;
      } catch (err) {
        const reason = classifyError(err);

        // Context overflow → 3-level recovery
        if (reason === "context_overflow") {
          if (!compactionAttempted) {
            // Level 1: compact messages via LLM summary
            compactionAttempted = true;
            const oldCount = messages.length;

            const summarizer = async (prompt: string): Promise<string> => {
              const summaryContext: Context = {
                messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
              };
              const summaryMsg = await callLLM({ model, context: summaryContext, options: { apiKey, signal } });
              return extractText(summaryMsg);
            };

            messages = await compactMessages(messages, summarizer);
            const newCount = messages.length;
            emit({ type: "compaction", oldCount, newCount });
            continue; // retry same iteration
          }

          if (!truncationAttempted) {
            // Level 2: truncate oversized tool results
            truncationAttempted = true;
            const oldCount = messages.length;
            messages = truncateOversizedToolResults(messages);
            emit({ type: "compaction", oldCount, newCount: messages.length });
            continue; // retry
          }

          // Level 3: give up
          throw new Error(
            `Context overflow persists after compaction and truncation. ` +
              `Original error: ${err instanceof Error ? err.message : String(err)}`,
          );
        }

        // Retriable errors → rotate profile
        if (isRetriable(reason) && retries < maxRetries) {
          markProfileFailed(profileStates[currentProfileIndex]);
          const nextIdx = nextProfileIndex(
            currentProfileIndex,
            config.provider.authProfiles.length,
          );
          currentProfileIndex = nextIdx;
          retries++;

          emit({
            type: "retry",
            attempt: retries,
            reason,
            profileId: config.provider.authProfiles[currentProfileIndex].id,
          });
          continue;
        }

        // Non-retriable or retries exhausted
        throw err;
      }
    }

    if (!assistantMsg) {
      throw new Error("LLM call failed: all retries exhausted");
    }

    // ── 4b. Push assistant message ───────────────────────────────────

    messages.push(assistantMsg);

    // ── 4c. Extract tool calls ───────────────────────────────────────

    const toolCalls = extractToolCalls(assistantMsg);

    if (toolCalls.length === 0) {
      // Final reply — persist and return
      const newMessages = messages.slice(historyLength - 1); // include the new user message
      const transcriptMessages = messagesToTranscript(newMessages);
      appendMessages(sessionKey, transcriptMessages);
      updateSessionMeta(sessionKey, {
        model: config.provider.model,
        totalTokens: totalUsage.totalTokens,
      });

      const reply = extractText(assistantMsg);
      const result: RunResult = {
        reply,
        usage: totalUsage,
        lastCallUsage,
        iterations: iterations + 1,
        maxIterationsReached: false,
      };
      emit({ type: "done", result });
      return result;
    }

    // ── 4d. Execute each tool call ───────────────────────────────────

    for (const tc of toolCalls) {
      signal?.throwIfAborted();

      emit({ type: "tool_start", toolName: tc.name, toolCallId: tc.id });
      const startTime = Date.now();

      const tool = findTool(tools, tc.name);
      let toolResult: ToolResultMessage;

      if (!tool) {
        toolResult = {
          role: "toolResult",
          toolCallId: tc.id,
          toolName: tc.name,
          content: [{ type: "text", text: `Unknown tool: ${tc.name}` }],
          isError: true,
          timestamp: Date.now(),
        };
      } else {
        try {
          const execResult = await tool.execute(tc.id, tc.arguments, signal);
          const text = extractToolResultText(execResult);
          const truncated = truncateToolResult(text, maxToolResultChars);

          toolResult = {
            role: "toolResult",
            toolCallId: tc.id,
            toolName: tc.name,
            content: [{ type: "text", text: truncated }],
            isError: false,
            timestamp: Date.now(),
          };
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          toolResult = {
            role: "toolResult",
            toolCallId: tc.id,
            toolName: tc.name,
            content: [{ type: "text", text: `Tool execution error: ${errMsg}` }],
            isError: true,
            timestamp: Date.now(),
          };
        }
      }

      messages.push(toolResult);

      const durationMs = Date.now() - startTime;
      emit({
        type: "tool_end",
        toolName: tc.name,
        toolCallId: tc.id,
        durationMs,
        isError: toolResult.isError,
      });
    }

    // Reset compaction/truncation flags for next iteration
    compactionAttempted = false;
    truncationAttempted = false;
  }

  // ── 5. Max iterations reached ──────────────────────────────────────

  const newMessages = messages.slice(historyLength - 1);
  const transcriptMessages = messagesToTranscript(newMessages);
  appendMessages(sessionKey, transcriptMessages);
  updateSessionMeta(sessionKey, {
    model: config.provider.model,
    totalTokens: totalUsage.totalTokens,
  });

  // Extract the last assistant text as reply
  let reply = "";
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") {
      reply = extractText(messages[i] as AssistantMessage);
      break;
    }
  }

  const result: RunResult = {
    reply,
    usage: totalUsage,
    lastCallUsage,
    iterations,
    maxIterationsReached: true,
  };
  emit({ type: "done", result });
  return result;
}

// ── Internal helpers ─────────────────────────────────────────────────

function findAvailableProfile(
  states: ProfileState[],
  startIndex: number,
  count: number,
): ProfileState | undefined {
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    const idx = (startIndex + i) % count;
    if (!isProfileCoolingDown(states[idx], now)) {
      return states[idx];
    }
  }
  return undefined;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}
