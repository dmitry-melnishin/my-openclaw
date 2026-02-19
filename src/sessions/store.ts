/**
 * Session metadata store — persistent JSON file mapping session keys to metadata.
 *
 * File location:
 *   <sessionsDir>/sessions.json
 *
 * Shape:
 *   {
 *     "agent:main:channel:telegram:...": { sessionId, updatedAt, ... },
 *     ...
 *   }
 *
 * Follows OpenClaw's pattern: single JSON file, read–modify–write with
 * in-memory cache (mtime-checked).  File locking is deferred to a later
 * sprint — the command queue (Sprint 1.5) serialises writes per session.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { resolveSessionsDir, ensureDir } from "../config/paths.js";

// ── Types ───────────────────────────────────────────────────────────

export interface SessionEntry {
  /** Unique session id (UUID v4). */
  sessionId: string;
  /** Epoch-ms timestamp of last update. */
  updatedAt: number;
  /** Relative path to the JSONL transcript file. */
  sessionFile: string;
  /** Channel that last sent a message. */
  lastChannel?: string;
  /** Chat/peer id the last message was sent to. */
  lastTo?: string;
  /** Chat type of the last interaction. */
  chatType?: "direct" | "group" | "channel";
  /** Model used in the last agent run. */
  model?: string;
  /** Cumulative token usage. */
  totalTokens?: number;
  /** Arbitrary extra metadata (extensible). */
  extra?: Record<string, unknown>;
}

export type SessionStore = Record<string, SessionEntry>;

// ── Path helpers ────────────────────────────────────────────────────

const STORE_FILENAME = "sessions.json";

export function resolveStorePath(sessionsDir?: string): string {
  const dir = sessionsDir ?? resolveSessionsDir();
  return path.join(dir, STORE_FILENAME);
}

// ── Cache (mtime-based) ────────────────────────────────────────────

let cachedStore: SessionStore | null = null;
let cachedMtimeMs = 0;
let cachedStorePath = "";

/** Clear the in-memory store cache (for tests). */
export function clearStoreCache(): void {
  cachedStore = null;
  cachedMtimeMs = 0;
  cachedStorePath = "";
}

// ── Read ────────────────────────────────────────────────────────────

/**
 * Load the session store from disk.
 *
 * Returns a **clone** of the cached data when mtime hasn't changed,
 * so callers can mutate locally without poisoning the cache.
 */
export function loadSessionStore(options?: {
  sessionsDir?: string;
  noCache?: boolean;
}): SessionStore {
  const storePath = resolveStorePath(options?.sessionsDir);

  if (!fs.existsSync(storePath)) return {};

  // Check cache
  if (!options?.noCache && cachedStore && cachedStorePath === storePath) {
    try {
      const stat = fs.statSync(storePath);
      if (stat.mtimeMs === cachedMtimeMs) {
        return structuredClone(cachedStore);
      }
    } catch {
      // stat failed — fall through to re-read
    }
  }

  const raw = fs.readFileSync(storePath, "utf-8");
  let parsed: SessionStore;

  try {
    parsed = JSON.parse(raw) as SessionStore;
  } catch {
    // Corrupt file — start fresh but keep backup
    const backupPath = storePath + `.bak.${Date.now()}`;
    fs.copyFileSync(storePath, backupPath);
    parsed = {};
  }

  // Update cache
  try {
    const stat = fs.statSync(storePath);
    cachedMtimeMs = stat.mtimeMs;
  } catch {
    cachedMtimeMs = 0;
  }
  cachedStore = parsed;
  cachedStorePath = storePath;

  return structuredClone(parsed);
}

// ── Write ───────────────────────────────────────────────────────────

/**
 * Save the full session store to disk (atomic on best-effort basis).
 */
export function saveSessionStore(
  store: SessionStore,
  options?: { sessionsDir?: string },
): void {
  const storePath = resolveStorePath(options?.sessionsDir);
  ensureDir(path.dirname(storePath));

  const json = JSON.stringify(store, null, 2) + "\n";
  fs.writeFileSync(storePath, json, "utf-8");

  // Refresh cache
  try {
    const stat = fs.statSync(storePath);
    cachedMtimeMs = stat.mtimeMs;
  } catch {
    cachedMtimeMs = 0;
  }
  cachedStore = structuredClone(store);
  cachedStorePath = storePath;
}

// ── Read–modify–write ───────────────────────────────────────────────

/**
 * Atomically update the session store with a mutator function.
 *
 * The mutator receives a mutable clone of the current store and may
 * modify it in place.  The store is saved after the mutator returns.
 */
export function updateSessionStore(
  mutator: (store: SessionStore) => void,
  options?: { sessionsDir?: string },
): void {
  const store = loadSessionStore({
    sessionsDir: options?.sessionsDir,
    noCache: true, // always re-read inside mutation
  });
  mutator(store);
  saveSessionStore(store, options);
}

// ── High-level helpers ──────────────────────────────────────────────

/**
 * Get a single session entry, or `undefined` if it doesn't exist.
 */
export function getSessionEntry(
  sessionKey: string,
  options?: { sessionsDir?: string },
): SessionEntry | undefined {
  const store = loadSessionStore(options);
  return store[sessionKey];
}

/**
 * Create or update metadata for a session.
 *
 * If the entry doesn't exist yet a new one is created with a fresh
 * `sessionId`.  The `updatedAt` timestamp is always refreshed.
 *
 * @param sessionKey - The canonical session key.
 * @param patch      - Partial fields to merge into the entry.
 */
export function updateSessionMeta(
  sessionKey: string,
  patch: Partial<Omit<SessionEntry, "sessionId" | "sessionFile">>,
  options?: { sessionsDir?: string },
): SessionEntry {
  let result!: SessionEntry;

  updateSessionStore((store) => {
    const existing = store[sessionKey];

    if (existing) {
      // Merge patch into existing entry
      Object.assign(existing, patch, { updatedAt: Date.now() });
      result = existing;
    } else {
      // Create new entry
      const sessionId = crypto.randomUUID();
      const slug = sessionKey.replace(/:/g, "__");
      const entry: SessionEntry = {
        sessionId,
        updatedAt: Date.now(),
        sessionFile: `${slug}.jsonl`,
        ...patch,
      };
      store[sessionKey] = entry;
      result = entry;
    }
  }, options);

  return result;
}

/**
 * Delete a session entry from the store.
 * Returns `true` if the entry existed and was removed.
 */
export function deleteSessionEntry(
  sessionKey: string,
  options?: { sessionsDir?: string },
): boolean {
  let deleted = false;

  updateSessionStore((store) => {
    if (sessionKey in store) {
      delete store[sessionKey];
      deleted = true;
    }
  }, options);

  return deleted;
}

/**
 * List all session keys in the store.
 */
export function listSessionKeys(options?: { sessionsDir?: string }): string[] {
  const store = loadSessionStore(options);
  return Object.keys(store);
}

/**
 * Prune sessions older than `maxAgeMs`.
 * Returns the number of entries removed.
 */
export function pruneSessions(
  maxAgeMs: number,
  options?: { sessionsDir?: string },
): number {
  let pruned = 0;
  const cutoff = Date.now() - maxAgeMs;

  updateSessionStore((store) => {
    for (const key of Object.keys(store)) {
      if (store[key].updatedAt < cutoff) {
        delete store[key];
        pruned++;
      }
    }
  }, options);

  return pruned;
}
