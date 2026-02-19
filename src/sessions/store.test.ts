import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  loadSessionStore,
  saveSessionStore,
  updateSessionStore,
  getSessionEntry,
  updateSessionMeta,
  deleteSessionEntry,
  listSessionKeys,
  pruneSessions,
  clearStoreCache,
  resolveStorePath,
} from "./store.js";

// ── Test helpers ────────────────────────────────────────────────────

const TEST_KEY = "agent:main:channel:test:account:default:peer:direct:u1";
const TEST_KEY_2 = "agent:main:channel:test:account:default:peer:group:g1";
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "myclaw-store-test-"));
  clearStoreCache();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  clearStoreCache();
});

// ── resolveStorePath ────────────────────────────────────────────────

describe("resolveStorePath", () => {
  it("returns <sessionsDir>/sessions.json", () => {
    expect(resolveStorePath("/tmp/sessions")).toBe(
      path.join("/tmp/sessions", "sessions.json"),
    );
  });
});

// ── loadSessionStore ────────────────────────────────────────────────

describe("loadSessionStore", () => {
  it("returns empty object when file doesn't exist", () => {
    const store = loadSessionStore({ sessionsDir: tmpDir });
    expect(store).toEqual({});
  });

  it("loads existing store from disk", () => {
    const data = {
      [TEST_KEY]: {
        sessionId: "abc-123",
        updatedAt: 1000,
        sessionFile: "abc-123.jsonl",
      },
    };
    const storePath = resolveStorePath(tmpDir);
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(storePath, JSON.stringify(data), "utf-8");

    const store = loadSessionStore({ sessionsDir: tmpDir });
    expect(store[TEST_KEY]).toBeDefined();
    expect(store[TEST_KEY].sessionId).toBe("abc-123");
  });

  it("returns a clone (mutations don't affect cache)", () => {
    saveSessionStore(
      {
        [TEST_KEY]: {
          sessionId: "x",
          updatedAt: 1,
          sessionFile: "x.jsonl",
        },
      },
      { sessionsDir: tmpDir },
    );

    const a = loadSessionStore({ sessionsDir: tmpDir });
    a[TEST_KEY].sessionId = "MUTATED";

    const b = loadSessionStore({ sessionsDir: tmpDir });
    expect(b[TEST_KEY].sessionId).toBe("x"); // not mutated
  });

  it("handles corrupt JSON by starting fresh", () => {
    const storePath = resolveStorePath(tmpDir);
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(storePath, "NOT VALID JSON{{{", "utf-8");

    const store = loadSessionStore({ sessionsDir: tmpDir });
    expect(store).toEqual({});

    // Backup file should exist
    const files = fs.readdirSync(path.dirname(storePath));
    const backups = files.filter((f) => f.includes(".bak."));
    expect(backups.length).toBe(1);
  });
});

// ── saveSessionStore ────────────────────────────────────────────────

describe("saveSessionStore", () => {
  it("creates the directory and writes JSON", () => {
    const nested = path.join(tmpDir, "deep", "nested");
    saveSessionStore(
      { [TEST_KEY]: { sessionId: "s1", updatedAt: 1, sessionFile: "s1.jsonl" } },
      { sessionsDir: nested },
    );

    const storePath = resolveStorePath(nested);
    expect(fs.existsSync(storePath)).toBe(true);

    const data = JSON.parse(fs.readFileSync(storePath, "utf-8"));
    expect(data[TEST_KEY].sessionId).toBe("s1");
  });

  it("overwrites existing file", () => {
    saveSessionStore(
      { [TEST_KEY]: { sessionId: "v1", updatedAt: 1, sessionFile: "v1.jsonl" } },
      { sessionsDir: tmpDir },
    );
    saveSessionStore(
      { [TEST_KEY]: { sessionId: "v2", updatedAt: 2, sessionFile: "v2.jsonl" } },
      { sessionsDir: tmpDir },
    );

    const store = loadSessionStore({ sessionsDir: tmpDir, noCache: true });
    expect(store[TEST_KEY].sessionId).toBe("v2");
  });
});

// ── updateSessionStore ──────────────────────────────────────────────

describe("updateSessionStore", () => {
  it("reads, mutates, and writes atomically", () => {
    saveSessionStore(
      { [TEST_KEY]: { sessionId: "s1", updatedAt: 1, sessionFile: "s1.jsonl" } },
      { sessionsDir: tmpDir },
    );

    updateSessionStore(
      (store) => {
        store[TEST_KEY].updatedAt = 999;
      },
      { sessionsDir: tmpDir },
    );

    const store = loadSessionStore({ sessionsDir: tmpDir, noCache: true });
    expect(store[TEST_KEY].updatedAt).toBe(999);
  });
});

// ── getSessionEntry ─────────────────────────────────────────────────

describe("getSessionEntry", () => {
  it("returns the entry when it exists", () => {
    saveSessionStore(
      { [TEST_KEY]: { sessionId: "x", updatedAt: 1, sessionFile: "x.jsonl" } },
      { sessionsDir: tmpDir },
    );
    const entry = getSessionEntry(TEST_KEY, { sessionsDir: tmpDir });
    expect(entry?.sessionId).toBe("x");
  });

  it("returns undefined when key doesn't exist", () => {
    expect(
      getSessionEntry("nonexistent", { sessionsDir: tmpDir }),
    ).toBeUndefined();
  });
});

// ── updateSessionMeta ───────────────────────────────────────────────

describe("updateSessionMeta", () => {
  it("creates a new entry with generated sessionId", () => {
    const entry = updateSessionMeta(
      TEST_KEY,
      { lastChannel: "telegram", chatType: "direct" },
      { sessionsDir: tmpDir },
    );

    expect(entry.sessionId).toBeTruthy();
    expect(entry.sessionFile).toContain(".jsonl");
    expect(entry.lastChannel).toBe("telegram");
    expect(entry.chatType).toBe("direct");
    expect(typeof entry.updatedAt).toBe("number");
  });

  it("updates existing entry (merges patch)", () => {
    updateSessionMeta(
      TEST_KEY,
      { lastChannel: "telegram" },
      { sessionsDir: tmpDir },
    );

    const updated = updateSessionMeta(
      TEST_KEY,
      { model: "claude-sonnet-4-20250514", totalTokens: 100 },
      { sessionsDir: tmpDir },
    );

    expect(updated.lastChannel).toBe("telegram"); // preserved
    expect(updated.model).toBe("claude-sonnet-4-20250514"); // new
    expect(updated.totalTokens).toBe(100);
  });

  it("preserves sessionId on update", () => {
    const first = updateSessionMeta(
      TEST_KEY,
      { lastChannel: "telegram" },
      { sessionsDir: tmpDir },
    );
    const second = updateSessionMeta(
      TEST_KEY,
      { model: "gpt-4" },
      { sessionsDir: tmpDir },
    );

    expect(second.sessionId).toBe(first.sessionId);
  });

  it("refreshes updatedAt on every update", () => {
    const first = updateSessionMeta(TEST_KEY, {}, { sessionsDir: tmpDir });
    // Tiny delay to ensure updatedAt differs
    const second = updateSessionMeta(TEST_KEY, {}, { sessionsDir: tmpDir });
    expect(second.updatedAt).toBeGreaterThanOrEqual(first.updatedAt);
  });
});

// ── deleteSessionEntry ──────────────────────────────────────────────

describe("deleteSessionEntry", () => {
  it("removes an existing entry and returns true", () => {
    updateSessionMeta(TEST_KEY, {}, { sessionsDir: tmpDir });
    expect(deleteSessionEntry(TEST_KEY, { sessionsDir: tmpDir })).toBe(true);

    const entry = getSessionEntry(TEST_KEY, { sessionsDir: tmpDir });
    expect(entry).toBeUndefined();
  });

  it("returns false when key doesn't exist", () => {
    expect(deleteSessionEntry("nonexistent", { sessionsDir: tmpDir })).toBe(
      false,
    );
  });
});

// ── listSessionKeys ─────────────────────────────────────────────────

describe("listSessionKeys", () => {
  it("returns all keys", () => {
    updateSessionMeta(TEST_KEY, {}, { sessionsDir: tmpDir });
    updateSessionMeta(TEST_KEY_2, {}, { sessionsDir: tmpDir });

    const keys = listSessionKeys({ sessionsDir: tmpDir });
    expect(keys).toContain(TEST_KEY);
    expect(keys).toContain(TEST_KEY_2);
    expect(keys.length).toBe(2);
  });

  it("returns empty array when store is empty", () => {
    expect(listSessionKeys({ sessionsDir: tmpDir })).toEqual([]);
  });
});

// ── pruneSessions ───────────────────────────────────────────────────

describe("pruneSessions", () => {
  it("removes entries older than maxAgeMs", () => {
    // Insert one old and one fresh entry
    saveSessionStore(
      {
        [TEST_KEY]: {
          sessionId: "old",
          updatedAt: Date.now() - 100_000,
          sessionFile: "old.jsonl",
        },
        [TEST_KEY_2]: {
          sessionId: "new",
          updatedAt: Date.now(),
          sessionFile: "new.jsonl",
        },
      },
      { sessionsDir: tmpDir },
    );

    const pruned = pruneSessions(50_000, { sessionsDir: tmpDir });
    expect(pruned).toBe(1);

    const remaining = listSessionKeys({ sessionsDir: tmpDir });
    expect(remaining).toEqual([TEST_KEY_2]);
  });

  it("returns 0 when nothing to prune", () => {
    updateSessionMeta(TEST_KEY, {}, { sessionsDir: tmpDir });
    expect(pruneSessions(999_999_999, { sessionsDir: tmpDir })).toBe(0);
  });
});
