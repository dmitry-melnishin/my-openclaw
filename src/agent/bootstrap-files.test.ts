/**
 * Tests for loading bootstrap files from the workspace directory.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { loadBootstrapFiles, BOOTSTRAP_FILENAMES } from "./bootstrap-files.js";

// ── Suite ────────────────────────────────────────────────────────────

describe("loadBootstrapFiles", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "myclaw-bootstrap-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Basic loading ────────────────────────────────────────────────

  it("returns an empty array if no bootstrap files exist", () => {
    const files = loadBootstrapFiles(tmpDir);

    expect(files).toEqual([]);
  });

  it("loads AGENTS.md when present", () => {
    const content = "# Agent Instructions\nBe helpful.";
    fs.writeFileSync(path.join(tmpDir, "AGENTS.md"), content, "utf-8");

    const files = loadBootstrapFiles(tmpDir);

    expect(files).toHaveLength(1);
    expect(files[0]).toEqual({ name: "AGENTS.md", content });
  });

  it("skips empty files", () => {
    fs.writeFileSync(path.join(tmpDir, "AGENTS.md"), "# Real content", "utf-8");
    fs.writeFileSync(path.join(tmpDir, "SOUL.md"), "", "utf-8");
    fs.writeFileSync(path.join(tmpDir, "USER.md"), "   \n  \t  ", "utf-8");

    const files = loadBootstrapFiles(tmpDir);

    expect(files).toHaveLength(1);
    expect(files[0]!.name).toBe("AGENTS.md");
  });

  it("loads multiple bootstrap files in the correct order", () => {
    // Write files in reverse order to verify ordering is by BOOTSTRAP_FILENAMES, not FS order
    fs.writeFileSync(path.join(tmpDir, "MEMORY.md"), "Memory notes", "utf-8");
    fs.writeFileSync(path.join(tmpDir, "SOUL.md"), "Soul content", "utf-8");
    fs.writeFileSync(path.join(tmpDir, "AGENTS.md"), "Agent rules", "utf-8");
    fs.writeFileSync(path.join(tmpDir, "TOOLS.md"), "Tool defs", "utf-8");

    const files = loadBootstrapFiles(tmpDir);

    expect(files).toHaveLength(4);
    expect(files.map((f) => f.name)).toEqual([
      "AGENTS.md",
      "SOUL.md",
      "TOOLS.md",
      "MEMORY.md",
    ]);
  });

  // ── Size limits ──────────────────────────────────────────────────

  it("truncates files exceeding maxCharsPerFile", () => {
    const longContent = "x".repeat(200);
    fs.writeFileSync(path.join(tmpDir, "AGENTS.md"), longContent, "utf-8");

    const files = loadBootstrapFiles(tmpDir, { maxCharsPerFile: 50 });

    expect(files).toHaveLength(1);
    expect(files[0]!.content).toHaveLength(50);
    expect(files[0]!.content).toBe("x".repeat(50));
  });

  it("stops loading when totalMaxChars is reached", () => {
    fs.writeFileSync(path.join(tmpDir, "AGENTS.md"), "a".repeat(60), "utf-8");
    fs.writeFileSync(path.join(tmpDir, "SOUL.md"), "b".repeat(60), "utf-8");
    fs.writeFileSync(path.join(tmpDir, "USER.md"), "c".repeat(60), "utf-8");

    const files = loadBootstrapFiles(tmpDir, { totalMaxChars: 100 });

    // First file: 60 chars, second file: truncated to 40 chars (100 - 60)
    // Third file should not be loaded (budget exhausted)
    expect(files).toHaveLength(2);
    expect(files[0]!.name).toBe("AGENTS.md");
    expect(files[0]!.content).toHaveLength(60);
    expect(files[1]!.name).toBe("SOUL.md");
    expect(files[1]!.content).toHaveLength(40);
  });

  it("stops immediately when totalMaxChars is already reached before next file", () => {
    fs.writeFileSync(path.join(tmpDir, "AGENTS.md"), "a".repeat(100), "utf-8");
    fs.writeFileSync(path.join(tmpDir, "SOUL.md"), "b".repeat(50), "utf-8");

    const files = loadBootstrapFiles(tmpDir, { totalMaxChars: 100 });

    expect(files).toHaveLength(1);
    expect(files[0]!.name).toBe("AGENTS.md");
    expect(files[0]!.content).toHaveLength(100);
  });

  // ── Missing files ────────────────────────────────────────────────

  it("skips files that do not exist", () => {
    // Only SOUL.md exists — AGENTS.md is missing
    fs.writeFileSync(path.join(tmpDir, "SOUL.md"), "Soul data", "utf-8");

    const files = loadBootstrapFiles(tmpDir);

    expect(files).toHaveLength(1);
    expect(files[0]).toEqual({ name: "SOUL.md", content: "Soul data" });
  });

  // ── BOOTSTRAP_FILENAMES constant ─────────────────────────────────

  it("exports the correct list of bootstrap filenames", () => {
    expect(BOOTSTRAP_FILENAMES).toEqual([
      "AGENTS.md",
      "SOUL.md",
      "USER.md",
      "TOOLS.md",
      "IDENTITY.md",
      "MEMORY.md",
      "HEARTBEAT.md",
      "BOOTSTRAP.md",
    ]);
  });

  // ── Both limits applied together ─────────────────────────────────

  it("applies both maxCharsPerFile and totalMaxChars together", () => {
    fs.writeFileSync(path.join(tmpDir, "AGENTS.md"), "a".repeat(200), "utf-8");
    fs.writeFileSync(path.join(tmpDir, "SOUL.md"), "b".repeat(200), "utf-8");
    fs.writeFileSync(path.join(tmpDir, "USER.md"), "c".repeat(200), "utf-8");

    const files = loadBootstrapFiles(tmpDir, {
      maxCharsPerFile: 80,
      totalMaxChars: 150,
    });

    // AGENTS.md: truncated to 80 (per-file limit). Total = 80.
    // SOUL.md: truncated to 80 (per-file limit), then to 70 (remaining budget). Total = 150.
    // USER.md: not loaded (budget exhausted).
    expect(files).toHaveLength(2);
    expect(files[0]!.content).toHaveLength(80);
    expect(files[1]!.content).toHaveLength(70);
  });

  // ── Non-existent workspace directory ─────────────────────────────

  it("returns an empty array when the workspace directory does not exist", () => {
    const nonExistent = path.join(tmpDir, "does-not-exist");

    const files = loadBootstrapFiles(nonExistent);

    expect(files).toEqual([]);
  });
});
