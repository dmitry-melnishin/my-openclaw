/**
 * Combine Pi SDK coding tools with our custom tools.
 */

import { createCodingTools } from "@mariozechner/pi-coding-agent";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { Tool } from "@mariozechner/pi-ai";

import { createApplyPatchTool } from "./apply-patch.js";

/**
 * Create the full set of agent tools for a given workspace directory.
 *
 * Includes:
 * - Pi SDK coding tools: read, bash, edit, write, grep, find, ls
 * - Custom: apply_patch
 */
export function createAgentTools(workspaceDir: string): AgentTool<any>[] {
  const codingTools = createCodingTools(workspaceDir) as AgentTool<any>[];
  const applyPatch = createApplyPatchTool(workspaceDir);
  return [...codingTools, applyPatch];
}

/**
 * Find a tool by name. Returns `undefined` if not found.
 */
export function findTool(
  tools: AgentTool<any>[],
  name: string,
): AgentTool<any> | undefined {
  return tools.find((t) => t.name === name);
}

/**
 * Extract tool names for system prompt listing.
 */
export function getToolNames(tools: Pick<Tool, "name">[]): string[] {
  return tools.map((t) => t.name);
}
