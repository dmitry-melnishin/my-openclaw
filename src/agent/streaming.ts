/**
 * LLM call wrappers: streamLLM() and callLLM().
 *
 * Uses Pi SDK's `streamSimple` / `completeSimple` for full control
 * over retry and failover (we don't use the Agent class).
 *
 * Ref: openclaw/src/agents/pi-embedded-runner/ streaming integration
 */

import {
  streamSimple,
  completeSimple,
  getModel,
  type AssistantMessage,
  type AssistantMessageEvent,
  type Model,
} from "@mariozechner/pi-ai";

import type { CallLLMParams, AgentEventCallback } from "./types.js";

// ── Model resolution ─────────────────────────────────────────────────

/**
 * Resolve a Pi SDK `Model` by provider name and model ID.
 *
 * If the model is in Pi SDK's built-in registry, use that.
 * Otherwise, construct a manual Model with sensible defaults.
 */
export function resolveModel(
  providerName: string,
  modelId: string,
  baseUrl?: string,
): Model<any> {
  // Try the built-in registry first
  try {
    const model = getModel(providerName as any, modelId as any);
    if (model) {
      // Apply baseUrl override if provided
      if (baseUrl) {
        return { ...model, baseUrl };
      }
      return model;
    }
  } catch {
    // getModel may throw for unknown provider/modelId combos
  }

  // Construct a manual model with sensible defaults
  const manual: Model<any> = {
    id: modelId,
    name: modelId,
    api: providerName === "anthropic" ? "anthropic-messages" : "openai-completions",
    provider: providerName,
    baseUrl: baseUrl ?? getDefaultBaseUrl(providerName),
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: 8192,
  };

  return manual;
}

function getDefaultBaseUrl(provider: string): string {
  switch (provider) {
    case "anthropic":
      return "https://api.anthropic.com";
    case "openai":
      return "https://api.openai.com/v1";
    case "google":
      return "https://generativelanguage.googleapis.com";
    default:
      return "https://api.openai.com/v1";
  }
}

// ── Stream LLM call ──────────────────────────────────────────────────

/**
 * Call the LLM with streaming, forwarding events to `onEvent`.
 * Returns the final `AssistantMessage` from `stream.result()`.
 */
export async function streamLLM(
  params: CallLLMParams,
  onEvent?: AgentEventCallback,
): Promise<AssistantMessage> {
  const { model, context, options } = params;
  const stream = streamSimple(model, context, options);

  for await (const event of stream) {
    if (onEvent) {
      onEvent({ type: "llm_stream", event });
    }
  }

  return await stream.result();
}

// ── Non-streaming LLM call ───────────────────────────────────────────

/**
 * Call the LLM without streaming. Returns the `AssistantMessage`.
 */
export async function callLLM(params: CallLLMParams): Promise<AssistantMessage> {
  const { model, context, options } = params;
  return completeSimple(model, context, options);
}
