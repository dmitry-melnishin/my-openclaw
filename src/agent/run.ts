/**
 * Agent run loop — the core engine.
 *
 * Implements the main agent execution loop using Pi SDK types:
 * 1. Build system prompt from workspace files
 * 2. Load conversation history
 * 3. Call LLM (via Pi SDK's completeSimple) with retry + auth profile rotation
 * 4. Execute tool calls if any (using Pi SDK AgentTool)
 * 5. Loop until the LLM produces a text-only reply or max iterations
 * 6. Persist conversation to transcript
 *
 * Handles context overflow (auto-compact) and failover (auth profile rotation).
 */

import type { MyClawConfig } from "../config/schema.js";
import { appendMessage, appendMessages, loadTranscript } from "../sessions/index.js";
import type {
  Message,
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  Usage,
  TextContent,
  ToolCall,
} from "@mariozechner/pi-ai";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { RunResult } from "./types.js";
import { emptyUsage, addUsage, getAssistantText, getToolCalls } from "./types.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { ensureWorkspace, resolveWorkspace } from "./workspace.js";
import { createTools, executeTool, getToolResultText } from "./tools/index.js";
import { callLLM, streamLLM } from "./streaming.js";
import type { StreamCallback } from "./streaming.js";
import type { AssistantMessageEvent } from "@mariozechner/pi-ai";
import {
  classifyFailoverReason,
  isRetriableFailoverReason,
  FailoverError,
} from "./failover.js";
import {
  isContextOverflowError,
  compactMessages,
  truncateToolResult,
} from "./context-guard.js";
import {
  DEFAULT_MAX_ITERATIONS,
  DEFAULT_MAX_RETRIES,
  DEFAULT_MAX_TOOL_RESULT_CHARS,
} from "../config/defaults.js";

// ── Types ───────────────────────────────────────────────────────────

export interface RunAgentParams {
  /** Session key for conversation persistence. */
  sessionKey: string;
  /** The user's message. */
  userMessage: string;
  /** Validated config. */
  config: MyClawConfig;
  /** Abort signal for cancellation. */
  signal?: AbortSignal;
  /** Optional sessions directory override (for testing). */
  sessionsDir?: string;
  /**
   * Streaming callback — invoked for each incremental LLM event.
   *
   * When provided, the agent uses `streamSimple()` instead of
   * `completeSimple()`, delivering `text_delta`, `thinking_delta`,
   * `toolcall_start/end`, `done`, and `error` events in real time.
   *
   * When omitted, the agent buffers the full LLM response (non-streaming).
   */
  onEvent?: StreamCallback;
}

// ── Transcript ↔ Message conversion ─────────────────────────────────

/**
 * Convert session transcript messages to Pi SDK Message format.
 *
 * Transcript stores flat messages with role/content/toolCallId/meta;
 * we reconstruct Pi SDK's discriminated union types.
 */
function transcriptToMessages(
  transcript: Array<{
    role: string;
    content: string;
    toolCallId?: string;
    meta?: Record<string, unknown>;
  }>,
): Message[] {
  return transcript.map((t) => {
    if (t.role === "user") {
      return {
        role: "user" as const,
        content: t.content,
        timestamp: Date.now(),
      } satisfies UserMessage;
    }

    if (t.role === "assistant") {
      // Reconstruct Pi SDK AssistantMessage content array
      const content: (TextContent | ToolCall)[] = [];
      if (t.content) {
        content.push({ type: "text", text: t.content });
      }
      // Reconstruct tool calls from meta
      if (t.meta?.toolCalls) {
        const toolCalls = t.meta.toolCalls as Array<{
          id: string;
          name: string;
          arguments: Record<string, unknown>;
        }>;
        for (const tc of toolCalls) {
          content.push({
            type: "toolCall",
            id: tc.id,
            name: tc.name,
            arguments: tc.arguments,
          });
        }
      }
      return {
        role: "assistant" as const,
        content,
        api: "",
        provider: "",
        model: "",
        usage: emptyUsage(),
        stopReason: "stop" as const,
        timestamp: Date.now(),
      } satisfies AssistantMessage;
    }

    // tool result
    return {
      role: "toolResult" as const,
      toolCallId: t.toolCallId ?? "",
      toolName: (t.meta?.toolName as string) ?? "",
      content: [{ type: "text" as const, text: t.content }],
      isError: false,
      timestamp: Date.now(),
    } satisfies ToolResultMessage;
  });
}

// ── Main run loop ───────────────────────────────────────────────────

/**
 * Run the agent for a single user message.
 */
export async function runAgent(params: RunAgentParams): Promise<RunResult> {
  const {
    sessionKey,
    userMessage,
    config,
    signal,
    sessionsDir,
    onEvent,
  } = params;

  // ── Setup ──────────────────────────────────────────────────────

  const workspace = ensureWorkspace(config);
  const tools = createTools(workspace);
  const systemPrompt = buildSystemPrompt({ workspace, tools });

  // Load existing history
  const transcript = loadTranscript(sessionKey, { sessionsDir });
  const history = transcriptToMessages(transcript);

  // Build message array for LLM
  const userMsg: UserMessage = {
    role: "user",
    content: userMessage,
    timestamp: Date.now(),
  };
  let messages: Message[] = [...history, userMsg];

  // Auth profile rotation state
  const authProfiles = config.provider.authProfiles;
  let currentProfileIndex = 0;

  // Config-driven limits
  const maxIterations = config.agent?.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const maxRetries = config.agent?.maxRetries ?? DEFAULT_MAX_RETRIES;
  const maxToolResultChars =
    config.agent?.maxToolResultChars ?? DEFAULT_MAX_TOOL_RESULT_CHARS;

  // Usage accumulator
  let totalUsage: Usage = emptyUsage();
  let iterations = 0;
  let maxOverflowAttempts = 3;

  // ── Agent loop ─────────────────────────────────────────────────

  for (let i = 0; i < maxIterations; i++) {
    iterations++;

    if (signal?.aborted) {
      return {
        reply: "Agent run aborted.",
        usage: totalUsage,
        iterations,
        maxIterationsReached: false,
        error: { kind: "aborted", message: "Aborted by user" },
      };
    }

    // ── LLM call with retry + failover ───────────────────────

    let response: AssistantMessage | undefined;
    let lastError: unknown;

    for (let retry = 0; retry <= maxRetries; retry++) {
      try {
        const profile =
          authProfiles[currentProfileIndex] ?? authProfiles[0];

        const llmParams = {
          provider: config.provider.name,
          model: config.provider.model,
          apiKey: profile.apiKey,
          baseUrl: config.provider.baseUrl,
          systemPrompt,
          messages,
          tools,
          signal,
        };

        response = onEvent
          ? await streamLLM(llmParams, onEvent)
          : await callLLM(llmParams);

        break; // success
      } catch (err) {
        lastError = err;

        // Context overflow → auto-compact and retry
        if (isContextOverflowError(err) && maxOverflowAttempts > 0) {
          maxOverflowAttempts--;
          try {
            const profile =
              authProfiles[currentProfileIndex] ?? authProfiles[0];

            messages = await compactMessages(
              messages,
              async (compactParams) => {
                const result = await callLLM({
                  provider: compactParams.provider,
                  model: compactParams.model,
                  apiKey: compactParams.apiKey,
                  baseUrl: compactParams.baseUrl,
                  systemPrompt: "You are a helpful assistant that summarizes conversations.",
                  messages: compactParams.messages,
                  tools: [],
                });
                return { content: getAssistantText(result) };
              },
              {
                model: config.provider.model,
                apiKey: profile.apiKey,
                provider: config.provider.name,
                baseUrl: config.provider.baseUrl,
              },
            );

            continue; // retry with compacted messages
          } catch {
            // Compaction failed — fall through to failover
          }
        }

        // Auth/rate/billing errors → rotate profile
        const reason = classifyFailoverReason(err);
        if (isRetriableFailoverReason(reason)) {
          currentProfileIndex =
            (currentProfileIndex + 1) % authProfiles.length;

          if (retry === maxRetries) {
            throw new FailoverError(
              reason,
              `All retry attempts exhausted (${reason})`,
              {
                provider: config.provider.name,
                model: config.provider.model,
                profileId: authProfiles[currentProfileIndex]?.id,
                cause: err,
              },
            );
          }

          continue;
        }

        // Unknown/unretriable error — throw immediately
        throw err;
      }
    }

    if (!response) {
      throw (
        lastError ??
        new Error("LLM call failed without response or error")
      );
    }

    // Accumulate usage
    totalUsage = addUsage(totalUsage, response.usage);

    // Add assistant message to conversation
    messages.push(response);

    // ── No tool calls → final reply ──────────────────────────

    const toolCalls = getToolCalls(response);

    if (toolCalls.length === 0) {
      const replyText = getAssistantText(response);

      // Persist conversation
      const sessionOpts = sessionsDir ? { sessionsDir } : undefined;

      appendMessage(
        sessionKey,
        { role: "user", content: userMessage },
        sessionOpts,
      );
      appendMessage(
        sessionKey,
        {
          role: "assistant",
          content: replyText,
          meta: undefined,
        },
        sessionOpts,
      );

      return {
        reply: replyText,
        usage: totalUsage,
        iterations,
        maxIterationsReached: false,
      };
    }

    // ── Execute tool calls ───────────────────────────────────

    for (const toolCall of toolCalls) {
      if (signal?.aborted) {
        return {
          reply: "Agent run aborted during tool execution.",
          usage: totalUsage,
          iterations,
          maxIterationsReached: false,
          error: { kind: "aborted", message: "Aborted during tool execution" },
        };
      }

      const result = await executeTool(
        {
          id: toolCall.id,
          name: toolCall.name,
          arguments: toolCall.arguments,
        },
        tools,
        signal,
      );

      // Truncate tool result text
      const resultText = getToolResultText(result);
      const truncated = truncateToolResult(resultText, maxToolResultChars);

      const toolResultMsg: ToolResultMessage = {
        role: "toolResult",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: [{ type: "text", text: truncated }],
        isError: false,
        timestamp: Date.now(),
      };

      messages.push(toolResultMsg);
    }
  }

  // ── Max iterations reached ─────────────────────────────────────

  const sessionOpts = sessionsDir ? { sessionsDir } : undefined;

  appendMessage(
    sessionKey,
    { role: "user", content: userMessage },
    sessionOpts,
  );
  appendMessage(
    sessionKey,
    {
      role: "assistant",
      content: "I reached the maximum number of tool-use iterations. Here's what I've done so far — please review and let me know if you'd like me to continue.",
    },
    sessionOpts,
  );

  return {
    reply: "Max iterations reached. The agent used all available tool-call rounds.",
    usage: totalUsage,
    iterations,
    maxIterationsReached: true,
  };
}

