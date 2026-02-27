/**
 * Workspace directory setup and bootstrap file scaffolding.
 */

import fs from "node:fs";
import path from "node:path";

import { resolveWorkspaceDir, ensureDir } from "../config/index.js";
import type { MyClawConfig } from "../config/index.js";

// ── Ensure workspace ─────────────────────────────────────────────────

/**
 * Resolve and ensure the agent workspace directory exists.
 * Returns the absolute path.
 */
export function ensureWorkspace(config: MyClawConfig): string {
  const workspaceDir = resolveWorkspaceDir(config.agent?.workspaceDir);
  ensureDir(workspaceDir);
  return workspaceDir;
}

// ── Scaffold bootstrap files ─────────────────────────────────────────

const DEFAULT_AGENTS_MD = `# Agent Instructions

You are MyClaw, a helpful AI assistant.

## Guidelines
- Be concise and accurate.
- When unsure, say so rather than guessing.
- Follow the user's instructions carefully.
`;

/**
 * Create a starter AGENTS.md in the workspace if one doesn't already exist.
 * Never overwrites existing files.
 */
export function scaffoldBootstrapFiles(workspaceDir: string): void {
  const agentsPath = path.join(workspaceDir, "AGENTS.md");
  if (!fs.existsSync(agentsPath)) {
    ensureDir(workspaceDir);
    fs.writeFileSync(agentsPath, DEFAULT_AGENTS_MD, "utf-8");
  }
}
