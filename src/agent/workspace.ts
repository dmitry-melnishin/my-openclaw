/**
 * Workspace directory setup and validation.
 *
 * Ensures the agent workspace directory exists and contains default
 * files (e.g. a starter AGENTS.md). Called at the beginning of each run.
 */

import fs from "node:fs";
import path from "node:path";

import { resolveWorkspaceDir, ensureDir } from "../config/paths.js";
import type { MyClawConfig } from "../config/schema.js";

// ── Default workspace files ─────────────────────────────────────────

const DEFAULT_AGENTS_MD = `# Agent Instructions

You are a helpful AI assistant. Follow these guidelines:

- Be concise and direct
- Use tools proactively to complete tasks
- Think step by step for complex problems
- Ask for clarification when requirements are ambiguous
- When editing code, read the file first to understand context
`;

const DEFAULT_FILES: Array<{ name: string; content: string }> = [
  { name: "AGENTS.md", content: DEFAULT_AGENTS_MD },
];

// ── Public API ──────────────────────────────────────────────────────

/**
 * Resolve the workspace directory from config.
 *
 * Priority: config.agent.workspaceDir → default (~/.myclaw/workspace).
 */
export function resolveWorkspace(config: MyClawConfig): string {
  return resolveWorkspaceDir(config.agent?.workspaceDir);
}

/**
 * Ensure the workspace directory exists with default files.
 *
 * Creates the directory and any default files that don't already exist.
 * Existing files are never overwritten.
 *
 * @returns The resolved workspace directory path.
 */
export function ensureWorkspace(config: MyClawConfig): string {
  const workspace = resolveWorkspace(config);
  ensureDir(workspace);

  for (const { name, content } of DEFAULT_FILES) {
    const filePath = path.join(workspace, name);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, content, "utf-8");
    }
  }

  return workspace;
}

/**
 * Check if a path is within the workspace directory.
 * Used by tools to enforce workspace sandboxing.
 */
export function isInsideWorkspace(
  targetPath: string,
  workspace: string,
): boolean {
  const resolved = path.resolve(targetPath);
  const wsResolved = path.resolve(workspace);
  return resolved.startsWith(wsResolved + path.sep) || resolved === wsResolved;
}

/**
 * Resolve a path relative to the workspace.
 * Absolute paths are returned as-is, relative paths are joined with workspace.
 */
export function resolveWorkspacePath(
  inputPath: string,
  workspace: string,
): string {
  if (path.isAbsolute(inputPath)) return path.resolve(inputPath);
  return path.resolve(workspace, inputPath);
}
