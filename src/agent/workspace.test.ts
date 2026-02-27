/**
 * Tests for workspace directory setup and bootstrap file scaffolding.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { ensureWorkspace, scaffoldBootstrapFiles } from "./workspace.js";
import type { MyClawConfig } from "../config/index.js";

// ── Helpers ──────────────────────────────────────────────────────────

function makeConfig(workspaceDir: string): MyClawConfig {
  return {
    provider: {
      name: "anthropic",
      model: "test",
      authProfiles: [{ id: "test", apiKey: "sk-test" }],
    },
    agent: { workspaceDir },
  } as MyClawConfig;
}

// ── Suite ────────────────────────────────────────────────────────────

describe("workspace", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "myclaw-workspace-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── ensureWorkspace ──────────────────────────────────────────────

  describe("ensureWorkspace", () => {
    it("creates the workspace directory if it does not exist", () => {
      const wsDir = path.join(tmpDir, "new-workspace");
      const config = makeConfig(wsDir);

      const result = ensureWorkspace(config);

      expect(fs.existsSync(wsDir)).toBe(true);
      expect(fs.statSync(wsDir).isDirectory()).toBe(true);
      expect(result).toBe(path.resolve(wsDir));
    });

    it("returns the absolute workspace path", () => {
      const config = makeConfig(tmpDir);

      const result = ensureWorkspace(config);

      expect(path.isAbsolute(result)).toBe(true);
      expect(result).toBe(path.resolve(tmpDir));
    });

    it("succeeds when the workspace directory already exists", () => {
      const config = makeConfig(tmpDir);

      // Call twice — second should not throw
      ensureWorkspace(config);
      const result = ensureWorkspace(config);

      expect(fs.existsSync(tmpDir)).toBe(true);
      expect(result).toBe(path.resolve(tmpDir));
    });

    it("creates nested directories recursively", () => {
      const nested = path.join(tmpDir, "a", "b", "c");
      const config = makeConfig(nested);

      const result = ensureWorkspace(config);

      expect(fs.existsSync(nested)).toBe(true);
      expect(result).toBe(path.resolve(nested));
    });
  });

  // ── scaffoldBootstrapFiles ───────────────────────────────────────

  describe("scaffoldBootstrapFiles", () => {
    it("creates AGENTS.md with default content when it does not exist", () => {
      scaffoldBootstrapFiles(tmpDir);

      const agentsPath = path.join(tmpDir, "AGENTS.md");
      expect(fs.existsSync(agentsPath)).toBe(true);

      const content = fs.readFileSync(agentsPath, "utf-8");
      expect(content).toContain("# Agent Instructions");
      expect(content).toContain("MyClaw");
      expect(content).toContain("## Guidelines");
    });

    it("does not overwrite an existing AGENTS.md", () => {
      const agentsPath = path.join(tmpDir, "AGENTS.md");
      const customContent = "# My Custom Instructions\n";
      fs.writeFileSync(agentsPath, customContent, "utf-8");

      scaffoldBootstrapFiles(tmpDir);

      const content = fs.readFileSync(agentsPath, "utf-8");
      expect(content).toBe(customContent);
    });

    it("creates the workspace directory if it does not exist", () => {
      const nested = path.join(tmpDir, "sub", "dir");

      scaffoldBootstrapFiles(nested);

      expect(fs.existsSync(nested)).toBe(true);
      expect(fs.existsSync(path.join(nested, "AGENTS.md"))).toBe(true);
    });

    it("is idempotent when called multiple times", () => {
      scaffoldBootstrapFiles(tmpDir);
      const firstContent = fs.readFileSync(path.join(tmpDir, "AGENTS.md"), "utf-8");

      scaffoldBootstrapFiles(tmpDir);
      const secondContent = fs.readFileSync(path.join(tmpDir, "AGENTS.md"), "utf-8");

      expect(secondContent).toBe(firstContent);
    });
  });
});
