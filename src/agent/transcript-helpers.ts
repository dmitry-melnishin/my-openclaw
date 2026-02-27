/**
 * Conversion between TranscriptMessage[] (JSONL persistence) and Pi SDK Message[].
 * Also includes orphaned-tool-call repair.
 *
 * Ref: openclaw/src/agents/pi-embedded-runner/session-transcript-repair.ts
 */

import type {
  Message,
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  TextContent,
  ToolCall,
} from "@mariozechner/pi-ai";

import type { TranscriptMessage } from "../sessions/index.js";

// ── Transcript → Pi SDK Messages ─────────────────────────────────────

/**
 * Convert persisted `TranscriptMessage[]` into Pi SDK `Message[]`.
 *
 * - "user"      → UserMessage
 * - "assistant"  → AssistantMessage (content as TextContent[])
 * - "tool"       → ToolResultMessage
 * - "system"     → skipped (system prompt is separate in Pi SDK Context)
 */
export function transcriptToMessages(transcript: TranscriptMessage[]): Message[] {
  const messages: Message[] = [];

  for (const t of transcript) {
    switch (t.role) {
      case "user":
        messages.push({
          role: "user",
          content: t.content,
          timestamp: t.ts,
        } satisfies UserMessage);
        break;

      case "assistant": {
        // Reconstruct content array. If meta has stored content blocks, use them;
        // otherwise wrap text in a single TextContent.
        const contentBlocks = t.meta?.contentBlocks
          ? (t.meta.contentBlocks as AssistantMessage["content"])
          : ([{ type: "text", text: t.content }] as AssistantMessage["content"]);

        messages.push({
          role: "assistant",
          content: contentBlocks,
          api: (t.meta?.api as string) ?? "anthropic-messages",
          provider: (t.meta?.provider as string) ?? "anthropic",
          model: (t.meta?.model as string) ?? "unknown",
          usage: (t.meta?.usage as AssistantMessage["usage"]) ?? emptyUsage(),
          stopReason: (t.meta?.stopReason as AssistantMessage["stopReason"]) ?? "stop",
          timestamp: t.ts,
        } satisfies AssistantMessage);
        break;
      }

      case "tool": {
        messages.push({
          role: "toolResult",
          toolCallId: t.toolCallId ?? "unknown",
          toolName: t.meta?.toolName as string ?? "unknown",
          content: [{ type: "text", text: t.content }],
          isError: (t.meta?.isError as boolean) ?? false,
          timestamp: t.ts,
        } satisfies ToolResultMessage);
        break;
      }

      case "system":
        // Skip — system prompt handled separately
        break;
    }
  }

  return messages;
}

// ── Pi SDK Messages → Transcript ─────────────────────────────────────

/**
 * Convert Pi SDK `Message[]` back into `TranscriptMessage[]` for persistence.
 */
export function messagesToTranscript(messages: Message[]): TranscriptMessage[] {
  const transcript: TranscriptMessage[] = [];

  for (const msg of messages) {
    switch (msg.role) {
      case "user": {
        const text = typeof msg.content === "string"
          ? msg.content
          : msg.content
              .filter((c): c is TextContent => c.type === "text")
              .map((c) => c.text)
              .join("\n");
        transcript.push({
          role: "user",
          content: text,
          ts: msg.timestamp,
        });
        break;
      }

      case "assistant": {
        const text = extractText(msg);
        transcript.push({
          role: "assistant",
          content: text,
          ts: msg.timestamp,
          meta: {
            contentBlocks: msg.content,
            api: msg.api,
            provider: msg.provider,
            model: msg.model,
            usage: msg.usage,
            stopReason: msg.stopReason,
          },
        });
        break;
      }

      case "toolResult": {
        const textParts = msg.content
          .filter((c): c is TextContent => c.type === "text")
          .map((c) => c.text);
        transcript.push({
          role: "tool",
          content: textParts.join("\n"),
          ts: msg.timestamp,
          toolCallId: msg.toolCallId,
          meta: {
            toolName: msg.toolName,
            isError: msg.isError,
          },
        });
        break;
      }
    }
  }

  return transcript;
}

// ── Orphaned tool call repair ────────────────────────────────────────

/**
 * Scan for `AssistantMessage` with `ToolCall` items that have no matching
 * `ToolResultMessage` following them. Inject synthetic error results.
 *
 * **Critical**: API providers reject conversations with orphaned tool calls.
 */
export function repairOrphanedToolCalls(messages: Message[]): Message[] {
  const result: Message[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    result.push(msg);

    if (msg.role !== "assistant") continue;

    const toolCalls = extractToolCalls(msg);
    if (toolCalls.length === 0) continue;

    // Collect tool call IDs that need results
    const needsResult = new Set(toolCalls.map((tc) => tc.id));

    // Look ahead for matching ToolResultMessages
    for (let j = i + 1; j < messages.length; j++) {
      const next = messages[j];
      if (next.role === "toolResult") {
        needsResult.delete(next.toolCallId);
      } else if (next.role === "assistant") {
        // Next assistant message means we've passed all potential results
        break;
      }
    }

    // Inject synthetic error results for orphaned tool calls
    for (const tc of toolCalls) {
      if (!needsResult.has(tc.id)) continue;
      result.push({
        role: "toolResult",
        toolCallId: tc.id,
        toolName: tc.name,
        content: [{ type: "text", text: "[Tool result missing — session was interrupted]" }],
        isError: true,
        timestamp: msg.timestamp,
      } satisfies ToolResultMessage);
    }
  }

  return result;
}

// ── Extraction helpers ───────────────────────────────────────────────

/**
 * Extract concatenated text from an `AssistantMessage`.
 */
export function extractText(message: AssistantMessage): string {
  return message.content
    .filter((c): c is TextContent => c.type === "text")
    .map((c) => c.text)
    .join("");
}

/**
 * Extract `ToolCall` items from an `AssistantMessage`.
 */
export function extractToolCalls(message: AssistantMessage): ToolCall[] {
  return message.content.filter((c): c is ToolCall => c.type === "toolCall");
}

// ── Usage helpers ────────────────────────────────────────────────────

function emptyUsage(): AssistantMessage["usage"] {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}
