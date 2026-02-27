/**
 * Error classification and auth-profile failover with cooldowns.
 *
 * Ref: openclaw/src/agents/failover-error.ts, openclaw/src/agents/auth-profiles/
 */

import type { FailoverReason, ProfileState } from "./types.js";
import { BASE_COOLDOWN_MS, MAX_COOLDOWN_MS } from "./types.js";

// ── Helpers: extract info from unknown errors ────────────────────────

function getStatusCode(err: unknown): number | undefined {
  if (err == null || typeof err !== "object") return undefined;
  const e = err as Record<string, unknown>;
  for (const key of ["status", "statusCode"]) {
    if (typeof e[key] === "number") return e[key] as number;
  }
  // Nested: err.response.status
  if (e.response && typeof e.response === "object") {
    const resp = e.response as Record<string, unknown>;
    if (typeof resp.status === "number") return resp.status;
  }
  return undefined;
}

function getErrorMessage(err: unknown): string {
  if (err == null) return "";
  if (typeof err === "string") return err;
  if (typeof err === "object") {
    const e = err as Record<string, unknown>;
    if (typeof e.message === "string") return e.message;
    if (typeof e.errorMessage === "string") return e.errorMessage;
  }
  return String(err);
}

// ── Error classification ─────────────────────────────────────────────

const CONTEXT_OVERFLOW_PATTERNS = [
  "context_length_exceeded",
  "context window",
  "context length",
  "maximum context",
  "token limit",
  "too many tokens",
  "prompt is too long",
  "request too large",
  "max_tokens",
  "maximum number of tokens",
];

const TIMEOUT_PATTERNS = [
  "timeout",
  "timed out",
  "etimedout",
  "econnreset",
  "econnaborted",
  "socket hang up",
  "network error",
];

const QUOTA_PATTERNS = [
  "quota",
  "exceeded your current",
  "insufficient_quota",
  "billing hard limit",
];

/**
 * Classify an error into a `FailoverReason` for deciding how to recover.
 */
export function classifyError(err: unknown): FailoverReason {
  const status = getStatusCode(err);
  const msg = getErrorMessage(err).toLowerCase();

  // HTTP status-based classification
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  if (status === 402) return "billing";

  // Message-pattern classification
  if (CONTEXT_OVERFLOW_PATTERNS.some((p) => msg.includes(p))) return "context_overflow";
  if (TIMEOUT_PATTERNS.some((p) => msg.includes(p))) return "timeout";
  if (QUOTA_PATTERNS.some((p) => msg.includes(p))) return "quota";

  // 5xx could be transient
  if (status !== undefined && status >= 500) return "timeout";

  return "unknown";
}

// ── Retriability ─────────────────────────────────────────────────────

const RETRIABLE_REASONS: ReadonlySet<FailoverReason> = new Set([
  "auth",
  "rate_limit",
  "billing",
  "timeout",
]);

/**
 * Whether a failure reason is worth retrying (possibly on a different profile).
 */
export function isRetriable(reason: FailoverReason): boolean {
  return RETRIABLE_REASONS.has(reason);
}

// ── Profile rotation ─────────────────────────────────────────────────

export function nextProfileIndex(current: number, total: number): number {
  return (current + 1) % total;
}

// ── Cooldown logic ───────────────────────────────────────────────────

/**
 * Create a fresh array of profile states for a run.
 */
export function createProfileStates(count: number): ProfileState[] {
  return Array.from({ length: count }, (_, i) => ({
    index: i,
    cooldownMs: BASE_COOLDOWN_MS,
  }));
}

/**
 * Check whether a profile is still in its cooldown window.
 */
export function isProfileCoolingDown(state: ProfileState, now: number = Date.now()): boolean {
  if (state.failedAt === undefined) return false;
  return now - state.failedAt < state.cooldownMs;
}

/**
 * Mark a profile as having failed — set `failedAt`, double cooldown (capped).
 */
export function markProfileFailed(state: ProfileState): void {
  state.failedAt = Date.now();
  state.cooldownMs = Math.min(state.cooldownMs * 2, MAX_COOLDOWN_MS);
}

/**
 * Mark a profile as good — reset cooldown to base.
 */
export function markProfileGood(state: ProfileState): void {
  state.failedAt = undefined;
  state.cooldownMs = BASE_COOLDOWN_MS;
}
