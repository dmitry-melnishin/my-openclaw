/**
 * Tests for system prompt builder.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { buildSystemPrompt } from "./system-prompt.js";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@mariozechner/pi-ai";

describe("buildSystemPrompt", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "myclaw-sysprompt-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("includes default identity", () => {
    const prompt = buildSystemPrompt({ workspace: tmpDir });
    expect(prompt).toContain("helpful AI assistant");
  });

  it("allows identity override", () => {
    const prompt = buildSystemPrompt({
      workspace: tmpDir,
      identity: "You are a pirate.",
    });
    expect(prompt).toContain("You are a pirate.");
    expect(prompt).not.toContain("helpful AI assistant");
  });

  it("includes bootstrap files when present", () => {
    fs.writeFileSync(
      path.join(tmpDir, "AGENTS.md"),
      "# Instructions\nBe extra helpful.",
      "utf-8",
    );

    const prompt = buildSystemPrompt({ workspace: tmpDir });
    expect(prompt).toContain("Context Files");
    expect(prompt).toContain("Be extra helpful");
    expect(prompt).toContain('<file path="AGENTS.md"');
  });

  it("includes tool instructions", () => {
    const tools: AgentTool<any, any>[] = [
      {
        name: "test_tool",
        label: "Test Tool",
        description: "A test tool",
        parameters: Type.Object({}),
        execute: async () => ({ content: [{ type: "text" as const, text: "result" }], details: undefined }),
      },
    ];

    const prompt = buildSystemPrompt({ workspace: tmpDir, tools });
    expect(prompt).toContain("## Tools");
    expect(prompt).toContain("test_tool");
    expect(prompt).toContain("A test tool");
  });

  it("includes runtime context", () => {
    const prompt = buildSystemPrompt({ workspace: tmpDir });
    expect(prompt).toContain("## Runtime");
    expect(prompt).toContain("OS:");
    expect(prompt).toContain("CWD:");
    expect(prompt).toContain("Date:");
  });

  it("omits tools section when no tools provided", () => {
    const prompt = buildSystemPrompt({ workspace: tmpDir });
    expect(prompt).not.toContain("## Tools");
  });
});
