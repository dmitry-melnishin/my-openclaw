/**
 * Compose the system prompt from bootstrap files + runtime info.
 *
 * Section order follows OpenClaw convention:
 *   Identity → Bootstrap files → Available tools → Safety → Runtime
 *
 * Ref: openclaw/src/agents/system-prompt.ts
 */

import os from "node:os";

import { loadBootstrapFiles, type LoadBootstrapFilesOptions } from "./bootstrap-files.js";

// ── Options ──────────────────────────────────────────────────────────

export interface BuildSystemPromptOptions {
  workspaceDir: string;
  toolNames: string[];
  modelId?: string;
  bootstrapOptions?: LoadBootstrapFilesOptions;
}

// ── Builder ──────────────────────────────────────────────────────────

export function buildSystemPrompt(options: BuildSystemPromptOptions): string {
  const { workspaceDir, toolNames, modelId } = options;

  const sections: string[] = [];

  // 1. Identity
  sections.push(
    `<identity>
You are MyClaw, a helpful AI assistant with access to tools.
You can read, write, and edit files, run shell commands, and apply patches.
Always think step-by-step before using tools.
</identity>`,
  );

  // 2. Bootstrap files
  const bootstrapFiles = loadBootstrapFiles(workspaceDir, options.bootstrapOptions);
  if (bootstrapFiles.length > 0) {
    const fileBlocks = bootstrapFiles
      .map((f) => `<file path="${f.name}">\n${f.content}\n</file>`)
      .join("\n\n");
    sections.push(`<bootstrap-files>\n${fileBlocks}\n</bootstrap-files>`);
  }

  // 3. Available tools
  if (toolNames.length > 0) {
    const toolList = toolNames.map((n) => `- ${n}`).join("\n");
    sections.push(
      `<tools>
You have access to the following tools:
${toolList}

Use tools when you need to interact with the filesystem, run commands, or apply code changes.
Call tools by their exact name. Provide all required parameters.
</tools>`,
    );
  }

  // 4. Safety
  sections.push(
    `<safety>
- Never fabricate tool results. If a tool call fails, report the error honestly.
- Do not attempt to circumvent permission restrictions.
- If you are unsure about an action, ask the user before proceeding.
- Comply with the user's instructions unless they conflict with safety guidelines.
</safety>`,
  );

  // 5. Runtime
  const now = new Date().toISOString();
  const platform = `${os.platform()} ${os.arch()}`;
  const cwd = workspaceDir;

  sections.push(
    `<runtime>
- Current time: ${now}
- Platform: ${platform}
- Working directory: ${cwd}${modelId ? `\n- Model: ${modelId}` : ""}
</runtime>`,
  );

  return sections.join("\n\n");
}
