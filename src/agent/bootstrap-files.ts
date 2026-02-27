/**
 * Load bootstrap files (AGENTS.md, SOUL.md, etc.) from the workspace.
 *
 * Size limits prevent runaway system prompts from eating the context window:
 *   - 50 000 chars per individual file
 *   - 200 000 chars total across all files
 *
 * Ref: openclaw/src/agents/bootstrap-files.ts
 */

import fs from "node:fs";
import path from "node:path";

import type { BootstrapFile } from "./types.js";
import {
  DEFAULT_BOOTSTRAP_MAX_CHARS_PER_FILE,
  DEFAULT_BOOTSTRAP_TOTAL_MAX_CHARS,
} from "./types.js";

// ── Constants ────────────────────────────────────────────────────────

export const BOOTSTRAP_FILENAMES = [
  "AGENTS.md",
  "SOUL.md",
  "USER.md",
  "TOOLS.md",
  "IDENTITY.md",
  "MEMORY.md",
  "HEARTBEAT.md",
  "BOOTSTRAP.md",
] as const;

// ── Options ──────────────────────────────────────────────────────────

export interface LoadBootstrapFilesOptions {
  maxCharsPerFile?: number;
  totalMaxChars?: number;
}

// ── Loader ───────────────────────────────────────────────────────────

/**
 * Read bootstrap files from `workspaceDir`.
 *
 * - Skips files that don't exist or are empty.
 * - Truncates individual files at `maxCharsPerFile`.
 * - Stops loading when cumulative size exceeds `totalMaxChars`.
 */
export function loadBootstrapFiles(
  workspaceDir: string,
  options?: LoadBootstrapFilesOptions,
): BootstrapFile[] {
  const maxPerFile = options?.maxCharsPerFile ?? DEFAULT_BOOTSTRAP_MAX_CHARS_PER_FILE;
  const totalMax = options?.totalMaxChars ?? DEFAULT_BOOTSTRAP_TOTAL_MAX_CHARS;

  const files: BootstrapFile[] = [];
  let totalChars = 0;

  for (const name of BOOTSTRAP_FILENAMES) {
    if (totalChars >= totalMax) break;

    const filePath = path.join(workspaceDir, name);
    if (!fs.existsSync(filePath)) continue;

    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue; // permission error, etc.
    }

    if (!content.trim()) continue;

    // Truncate individual file
    if (content.length > maxPerFile) {
      content = content.slice(0, maxPerFile);
    }

    // Check total budget — truncate if adding this file would exceed
    const remaining = totalMax - totalChars;
    if (content.length > remaining) {
      content = content.slice(0, remaining);
    }

    totalChars += content.length;
    files.push({ name, content });
  }

  return files;
}
