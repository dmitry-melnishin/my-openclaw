/**
 * JSONL transcript storage — one file per session.
 *
 * Each session's conversation history is stored as a JSONL (newline-delimited
 * JSON) file.  Messages are appended atomically (one JSON object per line).
 *
 * File location:
 *   <sessionsDir>/<slug>.jsonl
 *
 * Line 1 is a **session header**:
 *   {"type":"session","sessionKey":"agent:main:...","createdAt":1708000000000}
 *
 * Subsequent lines are messages:
 *   {"role":"user","content":"Hello","ts":1708000000000}
 *   {"role":"assistant","content":"Hi!","ts":1708000001000}
 */

import fs from "node:fs";
import path from "node:path";

import { resolveSessionsDir, ensureDir } from "../config/paths.js";
import { sessionKeyToSlug } from "./session-key.js";

// ── Types ───────────────────────────────────────────────────────────

export type MessageRole = "user" | "assistant" | "system" | "tool";

export interface TranscriptMessage {
  /** Message role — who produced the message. */
  role: MessageRole;
  /** Text content. */
  content: string;
  /** Epoch-millisecond timestamp. */
  ts: number;
  /** Optional tool-call id (for tool results). */
  toolCallId?: string;
  /** Optional metadata bag — round-tripped but not interpreted. */
  meta?: Record<string, unknown>;
}

interface SessionHeader {
  type: "session";
  sessionKey: string;
  createdAt: number;
}

// ── Path helpers ────────────────────────────────────────────────────

/**
 * Resolve the `.jsonl` transcript file path for a given session key.
 */
export function resolveTranscriptPath(
  sessionKey: string,
  sessionsDir?: string,
): string {
  const dir = sessionsDir ?? resolveSessionsDir();
  const slug = sessionKeyToSlug(sessionKey);
  return path.join(dir, `${slug}.jsonl`);
}

// ── Write ───────────────────────────────────────────────────────────

/**
 * Ensure the transcript file exists with a valid session header.
 * No-op if the file already exists.
 */
function ensureTranscriptFile(filePath: string, sessionKey: string): void {
  ensureDir(path.dirname(filePath));

  if (fs.existsSync(filePath)) return;

  const header: SessionHeader = {
    type: "session",
    sessionKey,
    createdAt: Date.now(),
  };
  fs.writeFileSync(filePath, JSON.stringify(header) + "\n", "utf-8");
}

/**
 * Append a single message to a session's JSONL transcript.
 *
 * Creates the transcript file (with header) if it doesn't exist yet.
 */
export function appendMessage(
  sessionKey: string,
  message: Omit<TranscriptMessage, "ts"> & { ts?: number },
  options?: { sessionsDir?: string },
): void {
  const filePath = resolveTranscriptPath(sessionKey, options?.sessionsDir);
  ensureTranscriptFile(filePath, sessionKey);

  const entry: TranscriptMessage = {
    role: message.role,
    content: message.content,
    ts: message.ts ?? Date.now(),
    ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
    ...(message.meta ? { meta: message.meta } : {}),
  };

  fs.appendFileSync(filePath, JSON.stringify(entry) + "\n", "utf-8");
}

/**
 * Append multiple messages atomically (single `appendFileSync` call).
 */
export function appendMessages(
  sessionKey: string,
  messages: Array<Omit<TranscriptMessage, "ts"> & { ts?: number }>,
  options?: { sessionsDir?: string },
): void {
  if (messages.length === 0) return;

  const filePath = resolveTranscriptPath(sessionKey, options?.sessionsDir);
  ensureTranscriptFile(filePath, sessionKey);

  const lines = messages.map((msg) => {
    const entry: TranscriptMessage = {
      role: msg.role,
      content: msg.content,
      ts: msg.ts ?? Date.now(),
      ...(msg.toolCallId ? { toolCallId: msg.toolCallId } : {}),
      ...(msg.meta ? { meta: msg.meta } : {}),
    };
    return JSON.stringify(entry);
  });

  fs.appendFileSync(filePath, lines.join("\n") + "\n", "utf-8");
}

// ── Read ────────────────────────────────────────────────────────────

/**
 * Load the full transcript for a session.
 *
 * Returns an empty array if the transcript file doesn't exist.
 * Blank lines and the session header line are silently skipped.
 * Malformed lines are skipped with a warning (no throw).
 */
export function loadTranscript(
  sessionKey: string,
  options?: { sessionsDir?: string },
): TranscriptMessage[] {
  const filePath = resolveTranscriptPath(sessionKey, options?.sessionsDir);

  if (!fs.existsSync(filePath)) return [];

  const raw = fs.readFileSync(filePath, "utf-8");
  const lines = raw.split("\n");
  const messages: TranscriptMessage[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const parsed = JSON.parse(trimmed);
      // Skip session header lines
      if (parsed.type === "session") continue;
      // Validate minimal shape
      if (typeof parsed.role === "string" && typeof parsed.content === "string") {
        messages.push({
          role: parsed.role,
          content: parsed.content,
          ts: typeof parsed.ts === "number" ? parsed.ts : 0,
          ...(parsed.toolCallId ? { toolCallId: parsed.toolCallId } : {}),
          ...(parsed.meta ? { meta: parsed.meta } : {}),
        });
      }
    } catch {
      // Skip malformed lines — log in production, silence in MVP
    }
  }

  return messages;
}

/**
 * Count the number of messages in a transcript without loading them all.
 * Useful for display / pagination decisions.
 */
export function countMessages(
  sessionKey: string,
  options?: { sessionsDir?: string },
): number {
  const filePath = resolveTranscriptPath(sessionKey, options?.sessionsDir);

  if (!fs.existsSync(filePath)) return 0;

  const raw = fs.readFileSync(filePath, "utf-8");
  let count = 0;

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.type === "session") continue;
      if (typeof parsed.role === "string") count++;
    } catch {
      // skip
    }
  }

  return count;
}

// ── Delete ──────────────────────────────────────────────────────────

/**
 * Delete a session's transcript file. No-op if it doesn't exist.
 */
export function deleteTranscript(
  sessionKey: string,
  options?: { sessionsDir?: string },
): boolean {
  const filePath = resolveTranscriptPath(sessionKey, options?.sessionsDir);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}
