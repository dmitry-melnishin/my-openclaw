/**
 * Apply patch tool — apply unified diff patches.
 *
 * Enables multi-file edits in a single tool call using standard
 * unified diff format. Supports both creation and modification of files.
 *
 * This is a custom tool not provided by Pi SDK.
 * Uses Pi SDK's AgentTool interface with TypeBox parameter schemas.
 *
 * Patch format (unified diff):
 * ```
 * --- a/path/to/file.ts
 * +++ b/path/to/file.ts
 * @@ -10,6 +10,7 @@
 *  context line
 * -removed line
 * +added line
 *  context line
 * ```
 */

import fs from "node:fs";
import path from "node:path";

import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@mariozechner/pi-ai";
import type { Static } from "@mariozechner/pi-ai";
import { resolveWorkspacePath } from "../workspace.js";

// ── Parameter schema ────────────────────────────────────────────────

const ApplyPatchParams = Type.Object({
  patch: Type.String({
    description:
      "The unified diff patch content. Must use standard unified diff format.",
  }),
});

type ApplyPatchArgs = Static<typeof ApplyPatchParams>;

// ── Patch parsing ───────────────────────────────────────────────────

interface PatchHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: string[];
}

interface PatchFile {
  oldPath: string;
  newPath: string;
  hunks: PatchHunk[];
  isNew: boolean;
  isDeleted: boolean;
}

function parsePatch(patch: string): PatchFile[] {
  const files: PatchFile[] = [];
  const lines = patch.split("\n");
  let i = 0;

  while (i < lines.length) {
    // Find file header
    if (!lines[i].startsWith("---")) {
      i++;
      continue;
    }

    const oldLine = lines[i];
    i++;
    if (i >= lines.length || !lines[i].startsWith("+++")) continue;
    const newLine = lines[i];
    i++;

    // Parse paths (strip a/ and b/ prefixes)
    const oldPath = oldLine.replace(/^---\s+/, "").replace(/^a\//, "");
    const newPath = newLine.replace(/^\+\+\+\s+/, "").replace(/^b\//, "");

    const isNew = oldPath === "/dev/null";
    const isDeleted = newPath === "/dev/null";

    const file: PatchFile = {
      oldPath,
      newPath,
      hunks: [],
      isNew,
      isDeleted,
    };

    // Parse hunks
    while (i < lines.length && !lines[i].startsWith("---")) {
      if (!lines[i].startsWith("@@")) {
        i++;
        continue;
      }

      const hunkHeader = lines[i].match(
        /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/,
      );
      if (!hunkHeader) {
        i++;
        continue;
      }

      const hunk: PatchHunk = {
        oldStart: parseInt(hunkHeader[1], 10),
        oldCount: hunkHeader[2] !== undefined ? parseInt(hunkHeader[2], 10) : 1,
        newStart: parseInt(hunkHeader[3], 10),
        newCount: hunkHeader[4] !== undefined ? parseInt(hunkHeader[4], 10) : 1,
        lines: [],
      };

      i++;

      // Collect hunk lines (context, additions, deletions)
      while (i < lines.length) {
        const line = lines[i];
        if (
          line.startsWith(" ") ||
          line.startsWith("+") ||
          line.startsWith("-")
        ) {
          hunk.lines.push(line);
          i++;
        } else if (line === "\\ No newline at end of file") {
          i++;
        } else {
          break;
        }
      }

      file.hunks.push(hunk);
    }

    files.push(file);
  }

  return files;
}

// ── Hunk application ────────────────────────────────────────────────

function applyHunks(originalContent: string, hunks: PatchHunk[]): string {
  const originalLines = originalContent.split("\n");
  const result = [...originalLines];
  let offset = 0; // track line shifts from previous hunks

  for (const hunk of hunks) {
    const startIdx = hunk.oldStart - 1 + offset;
    const newLines: string[] = [];

    for (const line of hunk.lines) {
      if (line.startsWith("+")) {
        newLines.push(line.slice(1));
      } else if (line.startsWith("-")) {
        // removed — skip
      } else {
        // context line (starts with " ")
        newLines.push(line.slice(1));
      }
    }

    const removeCount = hunk.lines.filter((l) => l.startsWith("-") || l.startsWith(" ")).length;
    result.splice(startIdx, removeCount, ...newLines);
    offset += newLines.length - removeCount;
  }

  return result.join("\n");
}

// ── Tool factory ────────────────────────────────────────────────────

export function createApplyPatchTool(
  workspace: string,
): AgentTool<typeof ApplyPatchParams, void> {
  return {
    name: "apply_patch",
    label: "Apply Patch",
    description: [
      "Apply a unified diff patch to one or more files.",
      "Supports creating, modifying, and deleting files.",
      "Use standard unified diff format with --- and +++ headers.",
      "This enables multi-file edits in a single tool call.",
    ].join("\n"),
    parameters: ApplyPatchParams,

    async execute(
      _toolCallId: string,
      args: ApplyPatchArgs,
      _signal?: AbortSignal,
    ): Promise<AgentToolResult<void>> {
      const patchStr = args.patch;
      if (!patchStr?.trim()) {
        return {
          content: [{ type: "text", text: "Error: patch content is required" }],
          details: undefined as unknown as void,
        };
      }

      let files: PatchFile[];
      try {
        files = parsePatch(patchStr);
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error parsing patch: ${err instanceof Error ? err.message : String(err)}` }],
          details: undefined as unknown as void,
        };
      }

      if (files.length === 0) {
        return {
          content: [{ type: "text", text: "Error: no valid patch hunks found. Check the diff format." }],
          details: undefined as unknown as void,
        };
      }

      const results: string[] = [];
      let applied = 0;
      let failed = 0;

      for (const file of files) {
        const filePath = resolveWorkspacePath(file.newPath, workspace);

        try {
          if (file.isDeleted) {
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
              results.push(`  Deleted: ${file.oldPath}`);
            } else {
              results.push(`  Skip delete (not found): ${file.oldPath}`);
            }
            applied++;
            continue;
          }

          if (file.isNew) {
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) {
              fs.mkdirSync(dir, { recursive: true });
            }

            const content = file.hunks
              .flatMap((h) =>
                h.lines.filter((l) => l.startsWith("+")).map((l) => l.slice(1)),
              )
              .join("\n");

            fs.writeFileSync(filePath, content, "utf-8");
            results.push(`  Created: ${file.newPath}`);
            applied++;
            continue;
          }

          // Modify existing file
          if (!fs.existsSync(filePath)) {
            results.push(`  Error (not found): ${file.oldPath}`);
            failed++;
            continue;
          }

          const original = fs.readFileSync(filePath, "utf-8");
          const patched = applyHunks(original, file.hunks);
          fs.writeFileSync(filePath, patched, "utf-8");
          results.push(`  Modified: ${file.newPath} (${file.hunks.length} hunk(s))`);
          applied++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          results.push(`  Error on ${file.newPath}: ${msg}`);
          failed++;
        }
      }

      const summary = `Patch applied: ${applied} succeeded, ${failed} failed`;
      const text = [summary, ...results].join("\n");
      return {
        content: [{ type: "text", text }],
        details: undefined as unknown as void,
      };
    },
  };
}
