import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createAgentTools,
  findTool,
  getToolNames,
} from "./create-tools.js";

describe("createAgentTools", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "create-tools-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns an array that includes Pi SDK tools and apply_patch", () => {
    const tools = createAgentTools(tmpDir);

    expect(Array.isArray(tools)).toBe(true);
    // Pi SDK coding tools provide several tools; together with apply_patch
    // we expect more than 1 entry.
    expect(tools.length).toBeGreaterThan(1);

    const names = tools.map((t) => t.name);
    expect(names).toContain("apply_patch");
  });

  it("all returned tools have name and execute properties", () => {
    const tools = createAgentTools(tmpDir);

    for (const tool of tools) {
      expect(typeof tool.name).toBe("string");
      expect(tool.name.length).toBeGreaterThan(0);
      expect(typeof tool.execute).toBe("function");
    }
  });

  it("apply_patch is included in the tool set", () => {
    const tools = createAgentTools(tmpDir);
    const applyPatch = tools.find((t) => t.name === "apply_patch");

    expect(applyPatch).toBeDefined();
    expect(applyPatch!.label).toBe("Apply Patch");
  });
});

describe("findTool", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "find-tool-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("finds a tool by name", () => {
    const tools = createAgentTools(tmpDir);
    const found = findTool(tools, "apply_patch");

    expect(found).toBeDefined();
    expect(found!.name).toBe("apply_patch");
  });

  it("returns undefined for an unknown tool name", () => {
    const tools = createAgentTools(tmpDir);
    const found = findTool(tools, "nonexistent_tool");

    expect(found).toBeUndefined();
  });
});

describe("getToolNames", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tool-names-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns a string array of tool names", () => {
    const tools = createAgentTools(tmpDir);
    const names = getToolNames(tools);

    expect(Array.isArray(names)).toBe(true);
    expect(names.length).toBe(tools.length);

    for (const name of names) {
      expect(typeof name).toBe("string");
    }

    expect(names).toContain("apply_patch");
  });
});
