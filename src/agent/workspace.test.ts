/**
 * Tests for workspace setup.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  ensureWorkspace,
  resolveWorkspace,
  isInsideWorkspace,
  resolveWorkspacePath,
} from "./workspace.js";
import type { MyClawConfig } from "../config/schema.js";

// Minimal valid config for testing
function makeConfig(overrides?: Partial<MyClawConfig>): MyClawConfig {
  return {
    provider: {
      name: "anthropic",
      model: "claude-sonnet-4-20250514",
      authProfiles: [{ id: "test", apiKey: "sk-test" }],
    },
    ...overrides,
  };
}

describe("workspace", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "myclaw-workspace-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("resolveWorkspace", () => {
    it("uses config workspaceDir when set", () => {
      const config = makeConfig({ agent: { workspaceDir: tmpDir } });
      expect(resolveWorkspace(config)).toBe(path.resolve(tmpDir));
    });

    it("falls back to default when agent config is absent", () => {
      const config = makeConfig();
      const ws = resolveWorkspace(config);
      expect(ws).toContain("workspace");
    });
  });

  describe("ensureWorkspace", () => {
    it("creates workspace directory", () => {
      const wsDir = path.join(tmpDir, "agent-ws");
      const config = makeConfig({ agent: { workspaceDir: wsDir } });

      ensureWorkspace(config);
      expect(fs.existsSync(wsDir)).toBe(true);
    });

    it("creates default AGENTS.md", () => {
      const wsDir = path.join(tmpDir, "agent-ws");
      const config = makeConfig({ agent: { workspaceDir: wsDir } });

      ensureWorkspace(config);
      const agentsPath = path.join(wsDir, "AGENTS.md");
      expect(fs.existsSync(agentsPath)).toBe(true);
      const content = fs.readFileSync(agentsPath, "utf-8");
      expect(content).toContain("Agent Instructions");
    });

    it("does not overwrite existing AGENTS.md", () => {
      const wsDir = path.join(tmpDir, "agent-ws");
      fs.mkdirSync(wsDir, { recursive: true });
      fs.writeFileSync(path.join(wsDir, "AGENTS.md"), "Custom", "utf-8");

      const config = makeConfig({ agent: { workspaceDir: wsDir } });
      ensureWorkspace(config);

      const content = fs.readFileSync(path.join(wsDir, "AGENTS.md"), "utf-8");
      expect(content).toBe("Custom");
    });
  });

  describe("isInsideWorkspace", () => {
    it("returns true for paths inside workspace", () => {
      expect(isInsideWorkspace(path.join(tmpDir, "foo", "bar.ts"), tmpDir)).toBe(true);
    });

    it("returns true for the workspace directory itself", () => {
      expect(isInsideWorkspace(tmpDir, tmpDir)).toBe(true);
    });

    it("returns false for paths outside workspace", () => {
      expect(isInsideWorkspace("/etc/passwd", tmpDir)).toBe(false);
    });

    it("returns false for directory traversal attempts", () => {
      expect(
        isInsideWorkspace(path.join(tmpDir, "..", "etc", "passwd"), tmpDir),
      ).toBe(false);
    });
  });

  describe("resolveWorkspacePath", () => {
    it("resolves relative paths against workspace", () => {
      const result = resolveWorkspacePath("src/index.ts", tmpDir);
      expect(result).toBe(path.resolve(tmpDir, "src/index.ts"));
    });

    it("returns absolute paths as-is (resolved)", () => {
      const abs = path.resolve("/tmp/foo.ts");
      const result = resolveWorkspacePath(abs, tmpDir);
      expect(result).toBe(abs);
    });
  });
});
