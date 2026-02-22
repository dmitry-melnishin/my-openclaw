/**
 * Tests for bootstrap file loading.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  loadBootstrapFiles,
  formatBootstrapFiles,
  tryReadFile,
} from "./bootstrap-files.js";

describe("bootstrap-files", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "myclaw-bootstrap-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("tryReadFile", () => {
    it("returns content for existing file", () => {
      const filePath = path.join(tmpDir, "test.txt");
      fs.writeFileSync(filePath, "hello world", "utf-8");
      expect(tryReadFile(filePath)).toBe("hello world");
    });

    it("returns null for missing file", () => {
      expect(tryReadFile(path.join(tmpDir, "nope.txt"))).toBeNull();
    });

    it("returns null for empty file", () => {
      const filePath = path.join(tmpDir, "empty.txt");
      fs.writeFileSync(filePath, "  \n  ", "utf-8");
      expect(tryReadFile(filePath)).toBeNull();
    });
  });

  describe("loadBootstrapFiles", () => {
    it("loads existing bootstrap files", () => {
      fs.writeFileSync(
        path.join(tmpDir, "AGENTS.md"),
        "# Agent instructions\nBe helpful.",
        "utf-8",
      );
      fs.writeFileSync(
        path.join(tmpDir, "SOUL.md"),
        "# Persona\nFriendly and concise.",
        "utf-8",
      );

      const files = loadBootstrapFiles(tmpDir);
      expect(files).toHaveLength(2);
      expect(files[0].filename).toBe("AGENTS.md");
      expect(files[0].role).toBe("Agent behavior instructions");
      expect(files[0].content).toContain("Be helpful");
      expect(files[1].filename).toBe("SOUL.md");
    });

    it("returns empty array when no files exist", () => {
      const files = loadBootstrapFiles(tmpDir);
      expect(files).toHaveLength(0);
    });

    it("skips empty files", () => {
      fs.writeFileSync(path.join(tmpDir, "AGENTS.md"), "", "utf-8");
      fs.writeFileSync(
        path.join(tmpDir, "SOUL.md"),
        "Has content",
        "utf-8",
      );

      const files = loadBootstrapFiles(tmpDir);
      expect(files).toHaveLength(1);
      expect(files[0].filename).toBe("SOUL.md");
    });
  });

  describe("formatBootstrapFiles", () => {
    it("wraps files in XML tags", () => {
      const files = [
        {
          filename: "AGENTS.md",
          role: "Agent behavior instructions",
          content: "Be helpful",
        },
      ];

      const formatted = formatBootstrapFiles(files);
      expect(formatted).toContain('<file path="AGENTS.md"');
      expect(formatted).toContain('role="Agent behavior instructions"');
      expect(formatted).toContain("Be helpful");
      expect(formatted).toContain("</file>");
    });

    it("returns empty string for no files", () => {
      expect(formatBootstrapFiles([])).toBe("");
    });

    it("joins multiple files with double newlines", () => {
      const files = [
        { filename: "A.md", role: "A", content: "a" },
        { filename: "B.md", role: "B", content: "b" },
      ];

      const formatted = formatBootstrapFiles(files);
      expect(formatted).toContain("</file>\n\n<file");
    });
  });
});
