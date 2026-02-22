/**
 * Tests for MVP tools: read, write, edit, bash, apply_patch.
 *
 * Uses Pi SDK's createCodingTools() for read/write/edit/bash and
 * our custom apply_patch tool. All tools use the AgentTool interface.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { createTools, executeTool, getToolResultText } from "./tools/index.js";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";

/** Helper to execute a tool and return the text result. */
async function execTool(
  tool: AgentTool<any, any>,
  args: Record<string, unknown>,
): Promise<string> {
  const result = await tool.execute("test_call", args);
  return getToolResultText(result);
}

describe("tools", () => {
  let tmpDir: string;
  let tools: AgentTool<any, any>[];

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "myclaw-tools-"));
    tools = createTools(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Tool registry ─────────────────────────────────────────────

  describe("createTools", () => {
    it("creates 5 tools (4 Pi SDK + apply_patch)", () => {
      expect(tools).toHaveLength(5);
      const names = tools.map((t) => t.name);
      expect(names).toContain("bash");
      expect(names).toContain("read");
      expect(names).toContain("write");
      expect(names).toContain("edit");
      expect(names).toContain("apply_patch");
    });
  });

  describe("executeTool", () => {
    it("returns error for unknown tool", async () => {
      const result = await executeTool(
        { id: "tc_1", name: "nonexistent", arguments: {} },
        tools,
      );
      const text = getToolResultText(result);
      expect(text).toContain("unknown tool");
    });
  });

  // ── write ─────────────────────────────────────────────────────

  describe("write", () => {
    it("creates a new file", async () => {
      const tool = tools.find((t) => t.name === "write")!;
      const result = await execTool(tool, {
        path: path.join(tmpDir, "test.txt"),
        content: "Hello, world!",
      });
      expect(result.toLowerCase()).toMatch(/created|wrote|written/);
      const content = fs.readFileSync(path.join(tmpDir, "test.txt"), "utf-8");
      expect(content).toBe("Hello, world!");
    });

    it("creates parent directories", async () => {
      const tool = tools.find((t) => t.name === "write")!;
      await execTool(tool, {
        path: path.join(tmpDir, "deep", "nested", "file.txt"),
        content: "deep content",
      });
      expect(
        fs.existsSync(path.join(tmpDir, "deep", "nested", "file.txt")),
      ).toBe(true);
    });

    it("overwrites existing file", async () => {
      const filePath = path.join(tmpDir, "existing.txt");
      fs.writeFileSync(filePath, "old", "utf-8");

      const tool = tools.find((t) => t.name === "write")!;
      await execTool(tool, {
        path: filePath,
        content: "new",
      });
      expect(fs.readFileSync(filePath, "utf-8")).toBe("new");
    });
  });

  // ── read ──────────────────────────────────────────────────────

  describe("read", () => {
    it("reads an existing file", async () => {
      fs.writeFileSync(
        path.join(tmpDir, "hello.txt"),
        "line1\nline2\nline3",
        "utf-8",
      );

      const tool = tools.find((t) => t.name === "read")!;
      const result = await execTool(tool, { path: path.join(tmpDir, "hello.txt") });
      expect(result).toContain("line1");
      expect(result).toContain("line2");
      expect(result).toContain("line3");
    });

    it("reads with offset and limit", async () => {
      const lines = Array.from({ length: 10 }, (_, i) => `Line ${i + 1}`);
      fs.writeFileSync(
        path.join(tmpDir, "range.txt"),
        lines.join("\n"),
        "utf-8",
      );

      const tool = tools.find((t) => t.name === "read")!;
      // Pi SDK read tool: offset = 1-based start line, limit = max lines returned
      const result = await execTool(tool, {
        path: path.join(tmpDir, "range.txt"),
        offset: 2,
        limit: 5,
      });
      expect(result).toContain("Line 2");
      expect(result).toContain("Line 3");
      expect(result).not.toContain("Line 1");
    });

    it("returns error for missing file", async () => {
      const tool = tools.find((t) => t.name === "read")!;
      // Pi SDK throws or returns error for missing files
      try {
        const result = await execTool(tool, { path: path.join(tmpDir, "nope.txt") });
        expect(result.toLowerCase()).toMatch(/not found|error|no such|does not exist/);
      } catch (err) {
        expect(err).toBeDefined();
      }
    });
  });

  // ── edit ──────────────────────────────────────────────────────

  describe("edit", () => {
    it("replaces exact match", async () => {
      const filePath = path.join(tmpDir, "edit.txt");
      fs.writeFileSync(filePath, "foo\nbar\nbaz\n", "utf-8");

      const tool = tools.find((t) => t.name === "edit")!;
      const result = await execTool(tool, {
        path: filePath,
        oldText: "bar",
        newText: "BAR_REPLACED",
      });
      expect(result.toLowerCase()).toMatch(/edited|replaced|updated|applied/);
      expect(fs.readFileSync(filePath, "utf-8")).toContain("BAR_REPLACED");
      expect(fs.readFileSync(filePath, "utf-8")).not.toContain("\nbar\n");
    });

    it("returns error when old string not found", async () => {
      fs.writeFileSync(path.join(tmpDir, "edit2.txt"), "hello", "utf-8");

      const tool = tools.find((t) => t.name === "edit")!;
      try {
        const result = await execTool(tool, {
          path: path.join(tmpDir, "edit2.txt"),
          oldText: "NOTFOUND",
          newText: "replacement",
        });
        expect(result.toLowerCase()).toMatch(/not found|error|no match/);
      } catch (err) {
        expect(err).toBeDefined();
      }
    });
  });

  // ── bash ──────────────────────────────────────────────────────

  describe("bash", () => {
    it("runs a simple command", async () => {
      // Pi SDK bash tool always uses /usr/bin/bash; skip on Windows unless WSL/Git Bash present
      const tool = tools.find((t) => t.name === "bash")!;
      try {
        const result = await execTool(tool, {
          command: "echo 'hello bash'",
        });
        expect(result).toContain("hello bash");
      } catch (err: any) {
        // If /usr/bin/bash doesn't exist (Windows without WSL), skip gracefully
        if (
          os.platform() === "win32" &&
          (err?.message?.includes("/usr/bin/bash") || err?.message?.includes("ENOENT") || err?.message?.includes("command not found"))
        ) {
          return; // skip on Windows without bash
        }
        throw err;
      }
    });

    it("returns error for empty command", async () => {
      const tool = tools.find((t) => t.name === "bash")!;
      try {
        const result = await execTool(tool, { command: "" });
        expect(result.toLowerCase()).toContain("error");
      } catch (err) {
        expect(err).toBeDefined();
      }
    });
  });

  // ── apply_patch ───────────────────────────────────────────────

  describe("apply_patch", () => {
    it("creates a new file", async () => {
      const tool = tools.find((t) => t.name === "apply_patch")!;
      const patch = [
        "--- /dev/null",
        "+++ b/newfile.txt",
        "@@ -0,0 +1,3 @@",
        "+line 1",
        "+line 2",
        "+line 3",
      ].join("\n");

      const result = await execTool(tool, { patch });
      expect(result).toContain("Created");
      expect(
        fs.existsSync(path.join(tmpDir, "newfile.txt")),
      ).toBe(true);
    });

    it("modifies an existing file", async () => {
      fs.writeFileSync(
        path.join(tmpDir, "mod.txt"),
        "line 1\nline 2\nline 3\n",
        "utf-8",
      );

      const tool = tools.find((t) => t.name === "apply_patch")!;
      const patch = [
        "--- a/mod.txt",
        "+++ b/mod.txt",
        "@@ -1,3 +1,3 @@",
        " line 1",
        "-line 2",
        "+LINE TWO",
        " line 3",
      ].join("\n");

      const result = await execTool(tool, { patch });
      expect(result).toContain("Modified");
      const content = fs.readFileSync(path.join(tmpDir, "mod.txt"), "utf-8");
      expect(content).toContain("LINE TWO");
      expect(content).not.toContain("line 2");
    });

    it("returns error for empty patch", async () => {
      const tool = tools.find((t) => t.name === "apply_patch")!;
      const result = await execTool(tool, { patch: "" });
      expect(result).toContain("Error");
    });
  });
});
