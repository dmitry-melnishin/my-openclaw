/**
 * Custom `apply_patch` tool — applies unified diffs to files.
 *
 * Uses the `diff` npm package for robust patch application.
 */

import fs from "node:fs";
import path from "node:path";
import { applyPatch, parsePatch } from "diff";
import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";

// ── Schema ───────────────────────────────────────────────────────────

const ApplyPatchSchema = Type.Object({
  patch: Type.String({
    description:
      "Unified diff to apply. Should include file paths in the --- / +++ headers.",
  }),
});

type ApplyPatchInput = Static<typeof ApplyPatchSchema>;

// ── Tool factory ─────────────────────────────────────────────────────

export function createApplyPatchTool(cwd: string): AgentTool<typeof ApplyPatchSchema> {
  return {
    name: "apply_patch",
    label: "Apply Patch",
    description:
      "Apply a unified diff (patch) to one or more files. " +
      "The patch should use standard unified diff format with --- and +++ headers.",
    parameters: ApplyPatchSchema,

    async execute(
      _toolCallId: string,
      params: ApplyPatchInput,
      _signal?: AbortSignal,
    ): Promise<AgentToolResult<any>> {
      try {
        const patches = parsePatch(params.patch).filter(
          (p) => p.hunks && p.hunks.length > 0,
        );

        if (patches.length === 0) {
          return {
            content: [{ type: "text", text: "No valid patches found in the input." }],
            details: { filesPatched: 0 },
          };
        }

        const results: string[] = [];

        for (const patch of patches) {
          // Determine target file path from the patch headers.
          // parsePatch gives us oldFileName / newFileName (e.g. "a/foo.ts" / "b/foo.ts")
          const rawPath =
            patch.newFileName && patch.newFileName !== "/dev/null"
              ? patch.newFileName
              : patch.oldFileName ?? "unknown";

          // Strip leading "a/" or "b/" git prefixes
          const relPath = rawPath.replace(/^[ab]\//, "");
          const absPath = path.resolve(cwd, relPath);

          // Read existing file or empty string for new files
          let original = "";
          const isNewFile =
            patch.oldFileName === "/dev/null" ||
            !fs.existsSync(absPath);

          if (!isNewFile) {
            original = fs.readFileSync(absPath, "utf-8");
          }

          const patched = applyPatch(original, patch);

          if (patched === false) {
            results.push(`FAILED: ${relPath} — patch does not apply cleanly`);
            continue;
          }

          // Handle file deletion
          if (patch.newFileName === "/dev/null") {
            if (fs.existsSync(absPath)) {
              fs.unlinkSync(absPath);
              results.push(`Deleted: ${relPath}`);
            }
            continue;
          }

          // Ensure parent directory exists
          const dir = path.dirname(absPath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }

          fs.writeFileSync(absPath, patched, "utf-8");
          results.push(`${isNewFile ? "Created" : "Patched"}: ${relPath}`);
        }

        const summary = `Applied patch to ${patches.length} file(s):\n${results.join("\n")}`;
        return {
          content: [{ type: "text", text: summary }],
          details: { filesPatched: patches.length, results },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Failed to apply patch: ${msg}` }],
          details: { error: msg },
        };
      }
    },
  };
}
