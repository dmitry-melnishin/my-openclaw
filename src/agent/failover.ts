/**
 * Error classification for auth profile failover.
 *
 * Classifies errors from LLM API calls into actionable categories so
 * the run loop knows whether to retry, rotate auth profiles, compact
 * context, or give up.
 *
 * Follows OpenClaw's `failover-error.ts` + `pi-embedded-helpers/errors.ts`.
 */

import type { FailoverReason } from "./types.js";

// ── FailoverError ───────────────────────────────────────────────────

export class FailoverError extends Error {
  readonly reason: FailoverReason;
  readonly provider?: string;
  readonly model?: string;
  readonly profileId?: string;
  readonly status?: number;

  constructor(
    reason: FailoverReason,
    message: string,
    opts?: {
      provider?: string;
      model?: string;
      profileId?: string;
      status?: number;
      cause?: unknown;
    },
  ) {
    super(message, { cause: opts?.cause });
    this.name = "FailoverError";
    this.reason = reason;
    this.provider = opts?.provider;
    this.model = opts?.model;
    this.profileId = opts?.profileId;
    this.status = opts?.status;
  }
}

// ── HTTP status classification ──────────────────────────────────────

function classifyByStatus(status: number): FailoverReason | null {
  if (status === 401 || status === 403) return "auth";
  if (status === 402) return "billing";
  if (status === 429) return "rate_limit";
  if (status === 408) return "timeout";
  if (status === 413) return "quota"; // payload too large (context overflow)
  // Transient server errors — treat as timeout (retriable)
  if ([500, 502, 503, 521, 522, 523, 524, 529].includes(status)) return "timeout";
  return null;
}

// ── Message-based classification ────────────────────────────────────

const AUTH_PATTERNS = [
  /invalid.*api.?key/i,
  /invalid.*auth/i,
  /authentication.*failed/i,
  /unauthorized/i,
  /forbidden/i,
  /permission.denied/i,
  /invalid.*x-api-key/i,
  /api.?key.*not.*valid/i,
  /invalid.*bearer/i,
];

const RATE_LIMIT_PATTERNS = [
  /rate.?limit/i,
  /too.many.requests/i,
  /overloaded/i,
  /throttl/i,
  /request.limit/i,
  /capacity/i,
];

const BILLING_PATTERNS = [
  /billing/i,
  /payment.*required/i,
  /insufficient.*funds/i,
  /account.*suspended/i,
  /quota.*exceeded/i,
  /credit/i,
];

const TIMEOUT_PATTERNS = [
  /timeout/i,
  /timed?\s*out/i,
  /ETIMEDOUT/,
  /ESOCKETTIMEDOUT/,
  /ECONNRESET/,
  /ECONNABORTED/,
  /ECONNREFUSED/,
  /network.*error/i,
  /fetch.*failed/i,
];

function classifyByMessage(msg: string): FailoverReason | null {
  for (const re of AUTH_PATTERNS) {
    if (re.test(msg)) return "auth";
  }
  for (const re of RATE_LIMIT_PATTERNS) {
    if (re.test(msg)) return "rate_limit";
  }
  for (const re of BILLING_PATTERNS) {
    if (re.test(msg)) return "billing";
  }
  for (const re of TIMEOUT_PATTERNS) {
    if (re.test(msg)) return "timeout";
  }
  return null;
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Classify an LLM API error into a failover reason.
 *
 * Checks (in order):
 * 1. HTTP status code on the error object
 * 2. Error name (TimeoutError, AbortError)
 * 3. Error message patterns
 *
 * Returns "unknown" if no pattern matches.
 */
export function classifyFailoverReason(err: unknown): FailoverReason {
  // 1. Check HTTP status
  const status = (err as Record<string, unknown>)?.status;
  if (typeof status === "number") {
    const byStatus = classifyByStatus(status);
    if (byStatus) return byStatus;
  }

  // 2. Check error name
  if (err instanceof Error) {
    if (err.name === "TimeoutError") return "timeout";
    if (err.name === "AbortError") return "timeout";
  }

  // 3. Check error message / string representation
  const msg = err instanceof Error ? err.message : String(err);
  const byMsg = classifyByMessage(msg);
  if (byMsg) return byMsg;

  return "unknown";
}

/**
 * Check if an error is retriable via auth profile rotation.
 *
 * Auth, rate_limit, and billing errors are retriable because a
 * different API key might work. Timeout is retriable as a transient.
 * Unknown errors are not retriable.
 */
export function isRetriableFailoverReason(reason: FailoverReason): boolean {
  return reason === "auth"
    || reason === "rate_limit"
    || reason === "billing"
    || reason === "timeout";
}
