/**
 * Bootstrap file loader — reads agent persona/context files from workspace.
 *
 * Bootstrap files are optional Markdown files that the user places in
 * the workspace directory to customise the agent's behaviour, knowledge,
 * and persona. They are injected into the system prompt.
 *
 * Follows OpenClaw's bootstrap file convention.
 */

import fs from "node:fs";
import path from "node:path";

// ── Bootstrap file manifest ─────────────────────────────────────────

/**
 * Ordered list of bootstrap files to look for.
 * Files are loaded in this order and appended to the system prompt.
 */
export const BOOTSTRAP_FILES = [
  { filename: "AGENTS.md", role: "Agent behavior instructions" },
  { filename: "SOUL.md", role: "Persona and tone" },
  { filename: "USER.md", role: "User profile" },
  { filename: "TOOLS.md", role: "Tool usage guidance" },
  { filename: "IDENTITY.md", role: "Identity overrides" },
  { filename: "HEARTBEAT.md", role: "Proactive task list" },
  { filename: "MEMORY.md", role: "Long-term knowledge" },
  { filename: "BOOTSTRAP.md", role: "General context" },
] as const;

// ── Types ───────────────────────────────────────────────────────────

export interface BootstrapFile {
  /** Filename (e.g. "AGENTS.md"). */
  filename: string;
  /** Role description (e.g. "Agent behavior instructions"). */
  role: string;
  /** The file's content (trimmed). */
  content: string;
}

// ── Loader ──────────────────────────────────────────────────────────

/**
 * Try to read a file, returning its content or `null` if it doesn't exist
 * or can't be read.
 */
export function tryReadFile(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, "utf-8").trim();
    return content || null;
  } catch {
    return null;
  }
}

/**
 * Load all bootstrap files from a workspace directory.
 *
 * Only returns files that exist and have non-empty content.
 */
export function loadBootstrapFiles(workspaceDir: string): BootstrapFile[] {
  const result: BootstrapFile[] = [];

  for (const { filename, role } of BOOTSTRAP_FILES) {
    const filePath = path.join(workspaceDir, filename);
    const content = tryReadFile(filePath);
    if (content) {
      result.push({ filename, role, content });
    }
  }

  return result;
}

/**
 * Format bootstrap files as system prompt sections.
 *
 * Each file is wrapped in `<file>` XML tags with the path attribute,
 * matching OpenClaw's convention for context injection.
 */
export function formatBootstrapFiles(files: BootstrapFile[]): string {
  if (files.length === 0) return "";

  return files
    .map(
      (f) =>
        `<file path="${f.filename}" role="${f.role}">\n${f.content}\n</file>`,
    )
    .join("\n\n");
}
