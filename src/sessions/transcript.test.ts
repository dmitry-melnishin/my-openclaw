import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  appendMessage,
  appendMessages,
  loadTranscript,
  countMessages,
  deleteTranscript,
  resolveTranscriptPath,
} from "./transcript.js";

// ── Test helpers ────────────────────────────────────────────────────

const TEST_KEY = "agent:main:channel:test:account:default:peer:direct:u1";
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "myclaw-transcript-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── resolveTranscriptPath ───────────────────────────────────────────

describe("resolveTranscriptPath", () => {
  it("returns <sessionsDir>/<slug>.jsonl", () => {
    const p = resolveTranscriptPath(TEST_KEY, "/tmp/sessions");
    expect(p).toBe(
      path.join(
        "/tmp/sessions",
        "agent__main__channel__test__account__default__peer__direct__u1.jsonl",
      ),
    );
  });
});

// ── appendMessage ───────────────────────────────────────────────────

describe("appendMessage", () => {
  it("creates the transcript file with header on first append", () => {
    appendMessage(
      TEST_KEY,
      { role: "user", content: "Hello" },
      { sessionsDir: tmpDir },
    );

    const filePath = resolveTranscriptPath(TEST_KEY, tmpDir);
    expect(fs.existsSync(filePath)).toBe(true);

    const lines = fs.readFileSync(filePath, "utf-8").trim().split("\n");
    expect(lines.length).toBe(2); // header + message

    const header = JSON.parse(lines[0]);
    expect(header.type).toBe("session");
    expect(header.sessionKey).toBe(TEST_KEY);

    const msg = JSON.parse(lines[1]);
    expect(msg.role).toBe("user");
    expect(msg.content).toBe("Hello");
    expect(typeof msg.ts).toBe("number");
  });

  it("appends to existing file without duplicating header", () => {
    appendMessage(
      TEST_KEY,
      { role: "user", content: "First" },
      { sessionsDir: tmpDir },
    );
    appendMessage(
      TEST_KEY,
      { role: "assistant", content: "Second" },
      { sessionsDir: tmpDir },
    );

    const filePath = resolveTranscriptPath(TEST_KEY, tmpDir);
    const lines = fs.readFileSync(filePath, "utf-8").trim().split("\n");
    expect(lines.length).toBe(3); // header + 2 messages

    // Only one header
    const headers = lines.filter((l) => JSON.parse(l).type === "session");
    expect(headers.length).toBe(1);
  });

  it("uses provided ts when given", () => {
    const ts = 1708000000000;
    appendMessage(
      TEST_KEY,
      { role: "user", content: "Hi", ts },
      { sessionsDir: tmpDir },
    );

    const messages = loadTranscript(TEST_KEY, { sessionsDir: tmpDir });
    expect(messages[0].ts).toBe(ts);
  });

  it("preserves optional toolCallId and meta", () => {
    appendMessage(
      TEST_KEY,
      {
        role: "tool",
        content: "result",
        toolCallId: "call_abc",
        meta: { source: "bash" },
      },
      { sessionsDir: tmpDir },
    );

    const messages = loadTranscript(TEST_KEY, { sessionsDir: tmpDir });
    expect(messages[0].toolCallId).toBe("call_abc");
    expect(messages[0].meta).toEqual({ source: "bash" });
  });
});

// ── appendMessages ──────────────────────────────────────────────────

describe("appendMessages", () => {
  it("appends multiple messages at once", () => {
    appendMessages(
      TEST_KEY,
      [
        { role: "user", content: "Hello", ts: 1000 },
        { role: "assistant", content: "Hi!", ts: 2000 },
        { role: "user", content: "Weather?", ts: 3000 },
      ],
      { sessionsDir: tmpDir },
    );

    const messages = loadTranscript(TEST_KEY, { sessionsDir: tmpDir });
    expect(messages.length).toBe(3);
    expect(messages[0].content).toBe("Hello");
    expect(messages[2].content).toBe("Weather?");
  });

  it("no-ops for empty array", () => {
    appendMessages(TEST_KEY, [], { sessionsDir: tmpDir });
    const filePath = resolveTranscriptPath(TEST_KEY, tmpDir);
    expect(fs.existsSync(filePath)).toBe(false);
  });
});

// ── loadTranscript ──────────────────────────────────────────────────

describe("loadTranscript", () => {
  it("returns empty array when no transcript exists", () => {
    const messages = loadTranscript(
      "agent:main:channel:test:account:default:peer:direct:nonexistent",
      { sessionsDir: tmpDir },
    );
    expect(messages).toEqual([]);
  });

  it("skips the session header line", () => {
    appendMessage(
      TEST_KEY,
      { role: "user", content: "Hello" },
      { sessionsDir: tmpDir },
    );
    const messages = loadTranscript(TEST_KEY, { sessionsDir: tmpDir });
    expect(messages.length).toBe(1);
    expect(messages[0].role).toBe("user");
  });

  it("skips blank lines gracefully", () => {
    // Manually write file with blank lines
    const filePath = resolveTranscriptPath(TEST_KEY, tmpDir);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      [
        '{"type":"session","sessionKey":"k","createdAt":0}',
        "",
        '{"role":"user","content":"A","ts":1}',
        "",
        '{"role":"assistant","content":"B","ts":2}',
        "",
      ].join("\n"),
      "utf-8",
    );

    const messages = loadTranscript(TEST_KEY, { sessionsDir: tmpDir });
    expect(messages.length).toBe(2);
  });

  it("skips malformed lines without throwing", () => {
    const filePath = resolveTranscriptPath(TEST_KEY, tmpDir);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      [
        '{"type":"session","sessionKey":"k","createdAt":0}',
        "NOT VALID JSON",
        '{"role":"user","content":"OK","ts":1}',
      ].join("\n"),
      "utf-8",
    );

    const messages = loadTranscript(TEST_KEY, { sessionsDir: tmpDir });
    expect(messages.length).toBe(1);
    expect(messages[0].content).toBe("OK");
  });

  it("preserves message order", () => {
    const ts = [1000, 2000, 3000];
    for (const t of ts) {
      appendMessage(
        TEST_KEY,
        { role: "user", content: `msg-${t}`, ts: t },
        { sessionsDir: tmpDir },
      );
    }

    const messages = loadTranscript(TEST_KEY, { sessionsDir: tmpDir });
    expect(messages.map((m) => m.ts)).toEqual(ts);
  });
});

// ── countMessages ───────────────────────────────────────────────────

describe("countMessages", () => {
  it("returns 0 when no transcript exists", () => {
    expect(
      countMessages(
        "agent:main:channel:test:account:default:peer:direct:missing",
        { sessionsDir: tmpDir },
      ),
    ).toBe(0);
  });

  it("counts only message lines (excludes header)", () => {
    appendMessages(
      TEST_KEY,
      [
        { role: "user", content: "A" },
        { role: "assistant", content: "B" },
      ],
      { sessionsDir: tmpDir },
    );

    expect(countMessages(TEST_KEY, { sessionsDir: tmpDir })).toBe(2);
  });
});

// ── deleteTranscript ────────────────────────────────────────────────

describe("deleteTranscript", () => {
  it("deletes existing transcript and returns true", () => {
    appendMessage(
      TEST_KEY,
      { role: "user", content: "bye" },
      { sessionsDir: tmpDir },
    );
    const deleted = deleteTranscript(TEST_KEY, { sessionsDir: tmpDir });
    expect(deleted).toBe(true);

    const filePath = resolveTranscriptPath(TEST_KEY, tmpDir);
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it("returns false when transcript doesn't exist", () => {
    expect(
      deleteTranscript(
        "agent:main:channel:test:account:default:peer:direct:nope",
        { sessionsDir: tmpDir },
      ),
    ).toBe(false);
  });
});
