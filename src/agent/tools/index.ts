/**
 * Tool registry — creates and manages all available tools.
 *
 * Uses Pi SDK's `createCodingTools()` for bash, read, write, edit,
 * plus our custom apply_patch tool.
 */

import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { createCodingTools } from "@mariozechner/pi-coding-agent";

import { createApplyPatchTool } from "./apply-patch.js";

// ── Tool creation ───────────────────────────────────────────────────

/**
 * Create the full set of MVP tools bound to a workspace directory.
 *
 * Pi SDK provides: read, bash, edit, write.
 * We add: apply_patch (custom tool for unified diff patches).
 */
export function createTools(workspace: string): AgentTool<any, any>[] {
  const piTools = createCodingTools(workspace);
  return [
    ...piTools,
    createApplyPatchTool(workspace),
  ];
}

/**
 * Execute a tool call by name.
 *
 * Looks up the tool in the provided tool list and runs it.
 *
 * @returns The tool result text (always succeeds — errors are returned as strings).
 */
export async function executeTool(
  toolCall: { id: string; name: string; arguments: Record<string, unknown> },
  tools: AgentTool<any, any>[],
  signal?: AbortSignal,
): Promise<AgentToolResult<any>> {
  const tool = tools.find((t) => t.name === toolCall.name);
  if (!tool) {
    return {
      content: [
        {
          type: "text",
          text: `Error: unknown tool "${toolCall.name}". Available tools: ${tools.map((t) => t.name).join(", ")}`,
        },
      ],
      details: undefined,
    };
  }

  try {
    return await tool.execute(toolCall.id, toolCall.arguments, signal);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      content: [
        {
          type: "text",
          text: `Error executing tool "${toolCall.name}": ${msg}`,
        },
      ],
      details: undefined,
    };
  }
}

/**
 * Extract text from an AgentToolResult.
 */
export function getToolResultText(result: AgentToolResult<any>): string {
  return result.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}
