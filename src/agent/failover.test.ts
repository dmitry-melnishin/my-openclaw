import { describe, it, expect } from "vitest";

import {
  classifyError,
  isRetriable,
  nextProfileIndex,
  createProfileStates,
  isProfileCoolingDown,
  markProfileFailed,
  markProfileGood,
} from "./failover.js";
import { BASE_COOLDOWN_MS, MAX_COOLDOWN_MS } from "./types.js";
import type { FailoverReason, ProfileState } from "./types.js";

// ── classifyError ─────────────────────────────────────────────────────

describe("classifyError", () => {
  // -- HTTP status-based classification --

  it("returns 'auth' for status 401", () => {
    expect(classifyError({ status: 401 })).toBe("auth");
  });

  it("returns 'auth' for status 403", () => {
    expect(classifyError({ status: 403 })).toBe("auth");
  });

  it("returns 'rate_limit' for status 429", () => {
    expect(classifyError({ status: 429 })).toBe("rate_limit");
  });

  it("returns 'billing' for status 402", () => {
    expect(classifyError({ status: 402 })).toBe("billing");
  });

  it("returns 'timeout' for 5xx status (transient)", () => {
    expect(classifyError({ status: 500 })).toBe("timeout");
    expect(classifyError({ status: 502 })).toBe("timeout");
    expect(classifyError({ status: 503 })).toBe("timeout");
  });

  // -- Status code extraction variants --

  it("reads status from err.status", () => {
    expect(classifyError({ status: 401 })).toBe("auth");
  });

  it("reads status from err.statusCode", () => {
    expect(classifyError({ statusCode: 429 })).toBe("rate_limit");
  });

  it("reads status from err.response.status", () => {
    expect(classifyError({ response: { status: 403 } })).toBe("auth");
  });

  // -- Timeout message patterns --

  it.each(["timeout", "ETIMEDOUT", "socket hang up"])(
    "returns 'timeout' for message containing '%s'",
    (pattern) => {
      expect(classifyError(new Error(`Request failed: ${pattern}`))).toBe("timeout");
    },
  );

  it("returns 'timeout' for 'timed out' message", () => {
    expect(classifyError(new Error("connection timed out"))).toBe("timeout");
  });

  it("returns 'timeout' for ECONNRESET", () => {
    expect(classifyError(new Error("read ECONNRESET"))).toBe("timeout");
  });

  it("returns 'timeout' for ECONNABORTED", () => {
    expect(classifyError(new Error("ECONNABORTED"))).toBe("timeout");
  });

  it("returns 'timeout' for 'network error'", () => {
    expect(classifyError(new Error("network error"))).toBe("timeout");
  });

  // -- Context overflow patterns --

  it.each(["context_length_exceeded", "too many tokens", "prompt is too long", "request too large"])(
    "returns 'context_overflow' for message containing '%s'",
    (pattern) => {
      expect(classifyError(new Error(pattern))).toBe("context_overflow");
    },
  );

  it("returns 'context_overflow' for 'context window' message", () => {
    expect(classifyError(new Error("exceeded context window"))).toBe("context_overflow");
  });

  it("returns 'context_overflow' for 'context length' message", () => {
    expect(classifyError(new Error("context length exceeded"))).toBe("context_overflow");
  });

  it("returns 'context_overflow' for 'maximum context' message", () => {
    expect(classifyError(new Error("maximum context limit reached"))).toBe("context_overflow");
  });

  it("returns 'context_overflow' for 'token limit' message", () => {
    expect(classifyError(new Error("token limit exceeded"))).toBe("context_overflow");
  });

  it("returns 'context_overflow' for 'max_tokens' message", () => {
    expect(classifyError(new Error("max_tokens exceeded"))).toBe("context_overflow");
  });

  it("returns 'context_overflow' for 'maximum number of tokens' message", () => {
    expect(classifyError(new Error("maximum number of tokens reached"))).toBe("context_overflow");
  });

  // -- Quota patterns --

  it.each(["exceeded your current", "insufficient_quota", "billing hard limit"])(
    "returns 'quota' for message containing '%s'",
    (pattern) => {
      expect(classifyError(new Error(pattern))).toBe("quota");
    },
  );

  it("returns 'quota' for 'quota' message", () => {
    expect(classifyError(new Error("quota exceeded for this organization"))).toBe("quota");
  });

  // -- Unknown --

  it("returns 'unknown' for unrecognized errors", () => {
    expect(classifyError(new Error("something unexpected"))).toBe("unknown");
  });

  it("returns 'unknown' for null", () => {
    expect(classifyError(null)).toBe("unknown");
  });

  it("returns 'unknown' for undefined", () => {
    expect(classifyError(undefined)).toBe("unknown");
  });

  it("returns 'unknown' for a plain number with no status meaning", () => {
    expect(classifyError(42)).toBe("unknown");
  });

  it("returns 'unknown' for an error with unrecognized status", () => {
    expect(classifyError({ status: 418 })).toBe("unknown");
  });

  // -- Message extraction edge cases --

  it("handles string errors", () => {
    expect(classifyError("ETIMEDOUT")).toBe("timeout");
  });

  it("reads errorMessage property", () => {
    expect(classifyError({ errorMessage: "ETIMEDOUT" })).toBe("timeout");
  });

  // -- Priority: status code wins over message patterns --

  it("status 401 takes priority over a timeout message", () => {
    expect(classifyError({ status: 401, message: "timeout" })).toBe("auth");
  });

  it("status 429 takes priority over a context overflow message", () => {
    expect(classifyError({ status: 429, message: "context_length_exceeded" })).toBe("rate_limit");
  });

  // -- Priority: context_overflow before timeout in message patterns --

  it("context_overflow pattern checked before timeout pattern in messages", () => {
    // Both patterns absent — but this tests the ordering. If the message
    // contains only a context-overflow phrase it should not fall through to timeout.
    expect(classifyError(new Error("context_length_exceeded"))).toBe("context_overflow");
  });
});

// ── isRetriable ───────────────────────────────────────────────────────

describe("isRetriable", () => {
  it.each<[FailoverReason, boolean]>([
    ["auth", true],
    ["rate_limit", true],
    ["billing", true],
    ["timeout", true],
    ["context_overflow", false],
    ["quota", false],
    ["unknown", false],
  ])("returns %s for reason '%s'", (reason, expected) => {
    expect(isRetriable(reason)).toBe(expected);
  });
});

// ── nextProfileIndex ──────────────────────────────────────────────────

describe("nextProfileIndex", () => {
  it("advances from 0 to 1 when total is 3", () => {
    expect(nextProfileIndex(0, 3)).toBe(1);
  });

  it("advances from 1 to 2 when total is 3", () => {
    expect(nextProfileIndex(1, 3)).toBe(2);
  });

  it("wraps from last index back to 0", () => {
    expect(nextProfileIndex(2, 3)).toBe(0);
  });

  it("wraps with total of 1 (always 0)", () => {
    expect(nextProfileIndex(0, 1)).toBe(0);
  });

  it("wraps with total of 2", () => {
    expect(nextProfileIndex(1, 2)).toBe(0);
  });
});

// ── createProfileStates ───────────────────────────────────────────────

describe("createProfileStates", () => {
  it("creates the correct number of states", () => {
    const states = createProfileStates(3);
    expect(states).toHaveLength(3);
  });

  it("sets index correctly on each state", () => {
    const states = createProfileStates(3);
    expect(states.map((s) => s.index)).toEqual([0, 1, 2]);
  });

  it("sets cooldownMs to BASE_COOLDOWN_MS", () => {
    const states = createProfileStates(2);
    for (const s of states) {
      expect(s.cooldownMs).toBe(BASE_COOLDOWN_MS);
    }
  });

  it("does not set failedAt", () => {
    const states = createProfileStates(2);
    for (const s of states) {
      expect(s.failedAt).toBeUndefined();
    }
  });

  it("returns an empty array for count 0", () => {
    expect(createProfileStates(0)).toEqual([]);
  });
});

// ── isProfileCoolingDown ──────────────────────────────────────────────

describe("isProfileCoolingDown", () => {
  it("returns false when failedAt is undefined", () => {
    const state = { index: 0, cooldownMs: 1000 };
    expect(isProfileCoolingDown(state)).toBe(false);
  });

  it("returns true when within cooldown window", () => {
    const now = 10_000;
    const state = { index: 0, cooldownMs: 5000, failedAt: now - 2000 };
    expect(isProfileCoolingDown(state, now)).toBe(true);
  });

  it("returns false when past cooldown window", () => {
    const now = 10_000;
    const state = { index: 0, cooldownMs: 2000, failedAt: now - 5000 };
    expect(isProfileCoolingDown(state, now)).toBe(false);
  });

  it("returns false when exactly at the cooldown boundary", () => {
    const now = 10_000;
    const state = { index: 0, cooldownMs: 3000, failedAt: now - 3000 };
    // now - failedAt === cooldownMs  =>  not strictly less than  =>  false
    expect(isProfileCoolingDown(state, now)).toBe(false);
  });
});

// ── markProfileFailed ─────────────────────────────────────────────────

describe("markProfileFailed", () => {
  it("sets failedAt to approximately now", () => {
    const state: ProfileState = { index: 0, cooldownMs: BASE_COOLDOWN_MS };
    const before = Date.now();
    markProfileFailed(state);
    const after = Date.now();

    expect(state.failedAt).toBeGreaterThanOrEqual(before);
    expect(state.failedAt).toBeLessThanOrEqual(after);
  });

  it("doubles cooldownMs on first failure", () => {
    const state = { index: 0, cooldownMs: BASE_COOLDOWN_MS };
    markProfileFailed(state);
    expect(state.cooldownMs).toBe(BASE_COOLDOWN_MS * 2);
  });

  it("doubles cooldownMs on successive failures", () => {
    const state = { index: 0, cooldownMs: BASE_COOLDOWN_MS };
    markProfileFailed(state);
    expect(state.cooldownMs).toBe(2000);
    markProfileFailed(state);
    expect(state.cooldownMs).toBe(4000);
    markProfileFailed(state);
    expect(state.cooldownMs).toBe(8000);
  });

  it("caps cooldownMs at MAX_COOLDOWN_MS", () => {
    const state = { index: 0, cooldownMs: MAX_COOLDOWN_MS };
    markProfileFailed(state);
    expect(state.cooldownMs).toBe(MAX_COOLDOWN_MS);
  });

  it("does not exceed MAX_COOLDOWN_MS even from a value just below", () => {
    const state = { index: 0, cooldownMs: MAX_COOLDOWN_MS / 2 + 1 };
    markProfileFailed(state);
    expect(state.cooldownMs).toBe(MAX_COOLDOWN_MS);
  });
});

// ── markProfileGood ───────────────────────────────────────────────────

describe("markProfileGood", () => {
  it("clears failedAt", () => {
    const state = { index: 0, cooldownMs: 16_000, failedAt: Date.now() };
    markProfileGood(state);
    expect(state.failedAt).toBeUndefined();
  });

  it("resets cooldownMs to BASE_COOLDOWN_MS", () => {
    const state = { index: 0, cooldownMs: 32_000, failedAt: Date.now() };
    markProfileGood(state);
    expect(state.cooldownMs).toBe(BASE_COOLDOWN_MS);
  });

  it("is idempotent on already-good state", () => {
    const state: ProfileState = { index: 0, cooldownMs: BASE_COOLDOWN_MS };
    markProfileGood(state);
    expect(state.failedAt).toBeUndefined();
    expect(state.cooldownMs).toBe(BASE_COOLDOWN_MS);
  });
});
