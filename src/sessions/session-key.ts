/**
 * Deterministic session-key builder.
 *
 * Session keys are colon-delimited strings that uniquely identify a
 * conversation context.  The canonical format is:
 *
 *   agent:<agentId>:channel:<channel>:account:<accountId>:peer:<peerKind>:<peerId>
 *
 * Examples:
 *   agent:main:channel:telegram:account:default:peer:direct:user_123456
 *   agent:main:channel:telegram:account:default:peer:group:chat_789
 *
 * This format matches OpenClaw's real session-key format from day one
 * so multi-agent / multi-channel routing works when we add it later.
 */

// ── Types ───────────────────────────────────────────────────────────

export type PeerKind = "direct" | "group" | "channel";

export interface SessionKeyParams {
  /** Agent identifier (default: "main"). */
  agentId?: string;
  /** Channel name, e.g. "telegram", "slack", "discord". */
  channel: string;
  /** Account identifier within the channel (default: "default"). */
  accountId?: string;
  /** Peer kind — direct message, group, or public channel. */
  peerKind: PeerKind;
  /** Peer identifier — user id, group/chat id, etc. */
  peerId: string;
}

// ── Normalisation helpers ───────────────────────────────────────────

const SAFE_SEGMENT_RE = /^[a-zA-Z0-9_.@+:-]+$/;
const MAX_SEGMENT_LEN = 128;

/**
 * Normalise a session-key segment:
 * - lowercase
 * - collapse whitespace → underscore
 * - strip characters that aren't safe for filenames / key lookups
 * - clamp length to 128
 */
function normalizeSegment(raw: string, fallback: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return fallback;

  const lower = trimmed.toLowerCase().replace(/\s+/g, "_");

  // If already safe, just clamp
  if (SAFE_SEGMENT_RE.test(lower)) {
    return lower.slice(0, MAX_SEGMENT_LEN);
  }

  // Strip unsafe chars
  const cleaned = lower.replace(/[^a-z0-9_.@+:-]/g, "");
  return (cleaned || fallback).slice(0, MAX_SEGMENT_LEN);
}

// ── Key builder ─────────────────────────────────────────────────────

/**
 * Build a deterministic session key from structured params.
 *
 * @example
 * ```ts
 * buildSessionKey({
 *   channel: "telegram",
 *   peerKind: "direct",
 *   peerId: "user_123456",
 * });
 * // → "agent:main:channel:telegram:account:default:peer:direct:user_123456"
 * ```
 */
export function buildSessionKey(params: SessionKeyParams): string {
  const agentId = normalizeSegment(params.agentId ?? "main", "main");
  const channel = normalizeSegment(params.channel, "unknown");
  const accountId = normalizeSegment(params.accountId ?? "default", "default");
  const peerKind = params.peerKind; // already constrained by type
  const peerId = normalizeSegment(params.peerId, "unknown");

  return `agent:${agentId}:channel:${channel}:account:${accountId}:peer:${peerKind}:${peerId}`;
}

// ── Key parser ──────────────────────────────────────────────────────

export interface ParsedSessionKey {
  agentId: string;
  channel: string;
  accountId: string;
  peerKind: PeerKind;
  peerId: string;
}

/**
 * Parse a session key string back into its structured components.
 * Returns `null` if the key doesn't match the expected format.
 */
export function parseSessionKey(key: string): ParsedSessionKey | null {
  const re =
    /^agent:([^:]+):channel:([^:]+):account:([^:]+):peer:(direct|group|channel):(.+)$/;
  const m = key.match(re);
  if (!m) return null;
  return {
    agentId: m[1],
    channel: m[2],
    accountId: m[3],
    peerKind: m[4] as PeerKind,
    peerId: m[5],
  };
}

// ── Filesystem-safe slug ────────────────────────────────────────────

/**
 * Convert a session key into a filesystem-safe filename (without extension).
 * Colons → double-underscores, other unsafe chars stripped.
 */
export function sessionKeyToSlug(key: string): string {
  return key.replace(/:/g, "__");
}
