import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { buildSystemPrompt } from "./system-prompt.js";

// ── Helpers ───────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "myclaw-sysprompt-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Tests ─────────────────────────────────────────────────────────────

describe("buildSystemPrompt", () => {
  it("contains the identity section", () => {
    const prompt = buildSystemPrompt({ workspaceDir: tmpDir, toolNames: [] });
    expect(prompt).toContain("<identity>");
    expect(prompt).toContain("MyClaw");
    expect(prompt).toContain("</identity>");
  });

  it("contains bootstrap files in XML tags when AGENTS.md exists", () => {
    fs.writeFileSync(path.join(tmpDir, "AGENTS.md"), "# Agent Guidelines\nBe helpful.");

    const prompt = buildSystemPrompt({ workspaceDir: tmpDir, toolNames: [] });

    expect(prompt).toContain("<bootstrap-files>");
    expect(prompt).toContain('<file path="AGENTS.md">');
    expect(prompt).toContain("# Agent Guidelines");
    expect(prompt).toContain("Be helpful.");
    expect(prompt).toContain("</file>");
    expect(prompt).toContain("</bootstrap-files>");
  });

  it("includes multiple bootstrap files when present", () => {
    fs.writeFileSync(path.join(tmpDir, "AGENTS.md"), "agents content");
    fs.writeFileSync(path.join(tmpDir, "SOUL.md"), "soul content");

    const prompt = buildSystemPrompt({ workspaceDir: tmpDir, toolNames: [] });

    expect(prompt).toContain('<file path="AGENTS.md">');
    expect(prompt).toContain("agents content");
    expect(prompt).toContain('<file path="SOUL.md">');
    expect(prompt).toContain("soul content");
  });

  it("omits bootstrap-files section when no bootstrap files exist", () => {
    const prompt = buildSystemPrompt({ workspaceDir: tmpDir, toolNames: ["read_file"] });
    expect(prompt).not.toContain("<bootstrap-files>");
  });

  it("contains tool names in the tools section", () => {
    const prompt = buildSystemPrompt({
      workspaceDir: tmpDir,
      toolNames: ["read_file", "write_file", "apply_patch"],
    });

    expect(prompt).toContain("<tools>");
    expect(prompt).toContain("- read_file");
    expect(prompt).toContain("- write_file");
    expect(prompt).toContain("- apply_patch");
    expect(prompt).toContain("</tools>");
  });

  it("omits tools section when toolNames is empty", () => {
    const prompt = buildSystemPrompt({ workspaceDir: tmpDir, toolNames: [] });
    expect(prompt).not.toContain("<tools>");
  });

  it("contains the safety section", () => {
    const prompt = buildSystemPrompt({ workspaceDir: tmpDir, toolNames: [] });
    expect(prompt).toContain("<safety>");
    expect(prompt).toContain("Never fabricate tool results");
    expect(prompt).toContain("</safety>");
  });

  it("contains the runtime section with platform, time, and cwd", () => {
    const prompt = buildSystemPrompt({ workspaceDir: tmpDir, toolNames: [] });

    expect(prompt).toContain("<runtime>");
    expect(prompt).toContain("Platform:");
    expect(prompt).toContain(`${os.platform()} ${os.arch()}`);
    expect(prompt).toContain("Current time:");
    expect(prompt).toContain(`Working directory: ${tmpDir}`);
    expect(prompt).toContain("</runtime>");
  });

  it("includes model in runtime section when modelId is provided", () => {
    const prompt = buildSystemPrompt({
      workspaceDir: tmpDir,
      toolNames: [],
      modelId: "claude-sonnet-4-20250514",
    });

    expect(prompt).toContain("Model: claude-sonnet-4-20250514");
  });

  it("does not include model line when modelId is omitted", () => {
    const prompt = buildSystemPrompt({ workspaceDir: tmpDir, toolNames: [] });
    expect(prompt).not.toContain("Model:");
  });

  it("passes bootstrapOptions through to loadBootstrapFiles", () => {
    // Write a file longer than our custom limit
    fs.writeFileSync(path.join(tmpDir, "AGENTS.md"), "A".repeat(200));

    const prompt = buildSystemPrompt({
      workspaceDir: tmpDir,
      toolNames: [],
      bootstrapOptions: { maxCharsPerFile: 50 },
    });

    // The content should be truncated to 50 chars
    expect(prompt).toContain("<bootstrap-files>");
    // Count the A's in the file tag — should be at most 50
    const fileMatch = prompt.match(/<file path="AGENTS.md">\n(A+)\n<\/file>/);
    expect(fileMatch).not.toBeNull();
    expect(fileMatch![1].length).toBe(50);
  });

  it("sections appear in correct order: identity, bootstrap, tools, safety, runtime", () => {
    fs.writeFileSync(path.join(tmpDir, "AGENTS.md"), "bootstrap content");

    const prompt = buildSystemPrompt({
      workspaceDir: tmpDir,
      toolNames: ["my_tool"],
      modelId: "test-model",
    });

    const identityIdx = prompt.indexOf("<identity>");
    const bootstrapIdx = prompt.indexOf("<bootstrap-files>");
    const toolsIdx = prompt.indexOf("<tools>");
    const safetyIdx = prompt.indexOf("<safety>");
    const runtimeIdx = prompt.indexOf("<runtime>");

    expect(identityIdx).toBeGreaterThanOrEqual(0);
    expect(bootstrapIdx).toBeGreaterThan(identityIdx);
    expect(toolsIdx).toBeGreaterThan(bootstrapIdx);
    expect(safetyIdx).toBeGreaterThan(toolsIdx);
    expect(runtimeIdx).toBeGreaterThan(safetyIdx);
  });
});
