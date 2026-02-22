/**
 * System prompt composition.
 *
 * Builds the system prompt from:
 * 1. Identity text
 * 2. Bootstrap files (AGENTS.md, SOUL.md, etc.)
 * 3. Tool instructions
 * 4. Runtime context (OS, CWD, date)
 *
 * Follows OpenClaw's system prompt hierarchy.
 */

import os from "node:os";

import { loadBootstrapFiles, formatBootstrapFiles } from "./bootstrap-files.js";
import type { AgentTool } from "@mariozechner/pi-agent-core";

// ── Types ───────────────────────────────────────────────────────────

export interface SystemPromptParams {
  /** Agent workspace directory. */
  workspace: string;
  /** Available tools (for generating tool instructions). */
  tools?: AgentTool<any, any>[];
  /** Custom identity override (replaces default). */
  identity?: string;
}

// ── Default identity ────────────────────────────────────────────────

const DEFAULT_IDENTITY = [
  "You are a helpful AI assistant with access to tools.",
  "You can read and write files, run shell commands, and edit code.",
  "Be concise and direct. When asked to perform tasks, use tools proactively.",
  "Think step by step for complex tasks. Show your reasoning when helpful.",
].join(" ");

// ── Tool instructions ───────────────────────────────────────────────

function buildToolInstructions(tools: AgentTool<any, any>[]): string {
  if (tools.length === 0) return "";

  const lines = [
    "## Tools",
    "",
    "You have access to the following tools. Use them when needed to complete tasks.",
    "",
  ];

  for (const tool of tools) {
    lines.push(`### ${tool.name}`);
    lines.push(tool.description);
    lines.push("");
  }

  lines.push(
    "**Guidelines:**",
    "- Use `bash` for system commands, installs, and file operations that tools don't cover.",
    "- Use `read` before editing to understand context.",
    "- Use `edit` for targeted changes (prefer over `write` for existing files).",
    "- Use `apply_patch` for multi-file changes in a single operation.",
    "- Chain tool calls when needed — don't ask for permission to use tools.",
    "- If a tool call fails, diagnose the error and retry with corrections.",
  );

  return lines.join("\n");
}

// ── Runtime context ─────────────────────────────────────────────────

function buildRuntimeContext(workspace: string): string {
  const now = new Date();
  return [
    "## Runtime",
    `- OS: ${os.platform()} ${os.arch()} (${os.release()})`,
    `- CWD: ${workspace}`,
    `- Date: ${now.toISOString().split("T")[0]}`,
    `- Time: ${now.toISOString().split("T")[1].split(".")[0]} UTC`,
    `- Node: ${process.version}`,
    `- Shell: ${os.platform() === "win32" ? "PowerShell" : "bash"}`,
  ].join("\n");
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Build the complete system prompt for an agent run.
 *
 * Sections are joined with double newlines and ordered:
 * identity → bootstrap files → tool instructions → runtime context.
 */
export function buildSystemPrompt(params: SystemPromptParams): string {
  const sections: string[] = [];

  // 1. Identity
  sections.push(params.identity ?? DEFAULT_IDENTITY);

  // 2. Bootstrap files (AGENTS.md, SOUL.md, etc.)
  const bootstrapFiles = loadBootstrapFiles(params.workspace);
  const formatted = formatBootstrapFiles(bootstrapFiles);
  if (formatted) {
    sections.push("## Context Files\n\n" + formatted);
  }

  // 3. Tool instructions
  if (params.tools && params.tools.length > 0) {
    sections.push(buildToolInstructions(params.tools));
  }

  // 4. Runtime info
  sections.push(buildRuntimeContext(params.workspace));

  return sections.join("\n\n");
}
