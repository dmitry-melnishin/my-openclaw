import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApplyPatchTool } from "./apply-patch.js";

describe("createApplyPatchTool", () => {
  let tmpDir: string;
  let tool: ReturnType<typeof createApplyPatchTool>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "apply-patch-test-"));
    tool = createApplyPatchTool(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("has correct name and label", () => {
    expect(tool.name).toBe("apply_patch");
    expect(tool.label).toBe("Apply Patch");
  });

  it("applies a valid patch to an existing file", async () => {
    // Create the original file
    const filePath = path.join(tmpDir, "test.txt");
    fs.writeFileSync(filePath, "line 1\nline 2\nline 3\n", "utf-8");

    const patch = [
      "--- a/test.txt",
      "+++ b/test.txt",
      "@@ -1,3 +1,3 @@",
      " line 1",
      "-line 2",
      "+line 2 modified",
      " line 3",
    ].join("\n");

    const result = await tool.execute("call-1", { patch });

    expect(result.content[0]).toEqual(
      expect.objectContaining({ type: "text" }),
    );
    expect((result.content[0] as { type: "text"; text: string }).text).toContain("Patched: test.txt");
    expect(result.details).toMatchObject({ filesPatched: 1 });

    const updated = fs.readFileSync(filePath, "utf-8");
    expect(updated).toContain("line 2 modified");
    expect(updated).not.toContain("\nline 2\n");
  });

  it("creates a new file from a patch (oldFileName is /dev/null)", async () => {
    const patch = [
      "--- /dev/null",
      "+++ b/newfile.txt",
      "@@ -0,0 +1,3 @@",
      "+alpha",
      "+beta",
      "+gamma",
    ].join("\n");

    const result = await tool.execute("call-2", { patch });

    expect((result.content[0] as { type: "text"; text: string }).text).toContain("Created: newfile.txt");

    const created = fs.readFileSync(path.join(tmpDir, "newfile.txt"), "utf-8");
    expect(created).toBe("alpha\nbeta\ngamma\n");
  });

  it("returns error for a non-applicable patch", async () => {
    // Create a file whose content does NOT match the patch context
    const filePath = path.join(tmpDir, "mismatch.txt");
    fs.writeFileSync(filePath, "completely different content\n", "utf-8");

    const patch = [
      "--- a/mismatch.txt",
      "+++ b/mismatch.txt",
      "@@ -1,3 +1,3 @@",
      " line 1",
      "-line 2",
      "+line 2 changed",
      " line 3",
    ].join("\n");

    const result = await tool.execute("call-3", { patch });

    expect((result.content[0] as { type: "text"; text: string }).text).toContain("FAILED");
    expect((result.content[0] as { type: "text"; text: string }).text).toContain("mismatch.txt");
  });

  it('returns "No valid patches found" for empty/invalid patch input', async () => {
    const result = await tool.execute("call-4", { patch: "" });

    expect((result.content[0] as { type: "text"; text: string }).text).toBe(
      "No valid patches found in the input.",
    );
    expect(result.details).toMatchObject({ filesPatched: 0 });
  });

  it("creates parent directories when patching into a nested path", async () => {
    const patch = [
      "--- /dev/null",
      "+++ b/sub/dir/deep.txt",
      "@@ -0,0 +1,1 @@",
      "+hello",
    ].join("\n");

    const result = await tool.execute("call-5", { patch });

    expect((result.content[0] as { type: "text"; text: string }).text).toContain("Created: sub/dir/deep.txt");
    const content = fs.readFileSync(
      path.join(tmpDir, "sub", "dir", "deep.txt"),
      "utf-8",
    );
    expect(content).toBe("hello\n");
  });
});
