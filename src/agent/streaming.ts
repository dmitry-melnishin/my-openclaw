/**
 * LLM streaming — thin wrapper around Pi SDK's streaming APIs.
 *
 * Provides both streaming (`streamLLM`) and non-streaming (`callLLM`) calls.
 * Pi SDK's `streamSimple()` handles all provider-specific SSE parsing,
 * auth headers, and response normalisation for 10+ providers.
 *
 * Also provides model resolution: maps config provider/model strings to
 * Pi SDK `Model` objects.
 */

import type {
  AssistantMessage,
  AssistantMessageEvent,
  Model,
  Api,
  Tool,
  Context,
} from "@mariozechner/pi-ai";
import {
  streamSimple,
  completeSimple,
  getModel,
  getModels,
} from "@mariozechner/pi-ai";

import type { AgentTool } from "@mariozechner/pi-agent-core";

// ── Model resolution ────────────────────────────────────────────────

/**
 * Default API mapping for providers that aren't in Pi's registry.
 */
const PROVIDER_API_DEFAULTS: Record<string, Api> = {
  anthropic: "anthropic-messages",
  openai: "openai-completions",
  google: "google-generative-ai",
  "amazon-bedrock": "bedrock-converse-stream",
};

/**
 * Resolve a Pi SDK Model from a provider name and model ID.
 *
 * First tries the Pi SDK model registry (`getModel`). If the model isn't
 * registered (e.g. new model, local Ollama, custom proxy), falls back to
 * constructing a minimal Model object with sensible defaults.
 */
export function resolveModel(
  provider: string,
  modelId: string,
  baseUrl?: string,
): Model<Api> {
  // Try the Pi SDK registry first
  try {
    const models = getModels(provider as any);
    const match = models.find((m) => m.id === modelId);
    if (match) {
      if (baseUrl) {
        return { ...match, baseUrl };
      }
      return match;
    }
  } catch {
    // Provider not known to Pi SDK — fall through to manual model
  }

  // Construct a fallback model for unknown provider/model combos
  const api: Api =
    PROVIDER_API_DEFAULTS[provider] ?? "openai-completions";

  const defaultBaseUrls: Record<string, string> = {
    anthropic: "https://api.anthropic.com",
    openai: "https://api.openai.com",
    google: "https://generativelanguage.googleapis.com",
    ollama: "http://localhost:11434",
  };

  return {
    id: modelId,
    name: modelId,
    api,
    provider: provider as any,
    baseUrl: baseUrl ?? defaultBaseUrls[provider] ?? "https://api.openai.com",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 8_192,
  };
}

// ── Call LLM params ─────────────────────────────────────────────────

export interface CallLLMParams {
  /** Provider name ("anthropic" | "openai" | "google" | "ollama"). */
  provider: string;
  /** Model identifier. */
  model: string;
  /** API key for this call. */
  apiKey: string;
  /** Optional base URL override. */
  baseUrl?: string;
  /** System prompt. */
  systemPrompt: string;
  /** Conversation messages (Pi SDK format). */
  messages: import("@mariozechner/pi-ai").Message[];
  /** Available tools (for LLM context). */
  tools: AgentTool<any, any>[];
  /** Abort signal. */
  signal?: AbortSignal;
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Callback invoked for each streaming event from the LLM.
 *
 * Pi SDK emits fine-grained events:
 * - `text_delta`     — incremental text token
 * - `thinking_delta` — incremental thinking/reasoning token
 * - `toolcall_start` / `toolcall_end` — tool call lifecycle
 * - `done`           — final message with full content + usage
 * - `error`          — stream error
 *
 * @see AssistantMessageEvent from `@mariozechner/pi-ai`
 */
export type StreamCallback = (event: AssistantMessageEvent) => void;

/**
 * Call an LLM provider using Pi SDK — non-streaming (buffered).
 *
 * Uses `completeSimple()` which handles all provider-specific wire
 * formats, auth headers, SSE parsing, and response normalisation.
 * Waits for the full response before returning.
 *
 * @returns The Pi SDK AssistantMessage with content, usage, stop reason, etc.
 */
export async function callLLM(
  params: CallLLMParams,
): Promise<AssistantMessage> {
  const model = resolveModel(params.provider, params.model, params.baseUrl);
  const context = buildContext(params);

  return completeSimple(model, context, {
    apiKey: params.apiKey,
    signal: params.signal,
  });
}

/**
 * Call an LLM provider using Pi SDK — streaming.
 *
 * Uses `streamSimple()` to return tokens incrementally via `onEvent`.
 * Still returns the final `AssistantMessage` so callers get the same
 * result type as `callLLM()` — just with real-time output during generation.
 *
 * @param params  - LLM call parameters (provider, model, messages, etc.)
 * @param onEvent - Callback invoked for each streaming event
 * @returns The final Pi SDK AssistantMessage (same as callLLM)
 */
export async function streamLLM(
  params: CallLLMParams,
  onEvent: StreamCallback,
): Promise<AssistantMessage> {
  const model = resolveModel(params.provider, params.model, params.baseUrl);
  const context = buildContext(params);

  const stream = streamSimple(model, context, {
    apiKey: params.apiKey,
    signal: params.signal,
  });

  // Iterate over events, forwarding each to the callback
  for await (const event of stream) {
    onEvent(event);
  }

  // The stream's .result() resolves to the final AssistantMessage
  return stream.result();
}

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Build a Pi SDK Context object from call params.
 */
function buildContext(params: CallLLMParams): Context {
  return {
    systemPrompt: params.systemPrompt,
    messages: params.messages,
    tools: params.tools.length > 0
      ? params.tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        }))
      : undefined,
  };
}

