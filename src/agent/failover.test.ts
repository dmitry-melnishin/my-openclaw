/**
 * Tests for failover error classification.
 */

import { describe, it, expect } from "vitest";
import { classifyFailoverReason, isRetriableFailoverReason, FailoverError } from "./failover.js";

describe("classifyFailoverReason", () => {
  // ── HTTP status codes ───────────────────────────────────────────

  it("classifies 401 as auth", () => {
    const err = Object.assign(new Error("Unauthorized"), { status: 401 });
    expect(classifyFailoverReason(err)).toBe("auth");
  });

  it("classifies 403 as auth", () => {
    const err = Object.assign(new Error("Forbidden"), { status: 403 });
    expect(classifyFailoverReason(err)).toBe("auth");
  });

  it("classifies 402 as billing", () => {
    const err = Object.assign(new Error("Payment Required"), { status: 402 });
    expect(classifyFailoverReason(err)).toBe("billing");
  });

  it("classifies 429 as rate_limit", () => {
    const err = Object.assign(new Error("Too Many Requests"), { status: 429 });
    expect(classifyFailoverReason(err)).toBe("rate_limit");
  });

  it("classifies 408 as timeout", () => {
    const err = Object.assign(new Error("Request Timeout"), { status: 408 });
    expect(classifyFailoverReason(err)).toBe("timeout");
  });

  it("classifies 413 as quota", () => {
    const err = Object.assign(new Error("Payload Too Large"), { status: 413 });
    expect(classifyFailoverReason(err)).toBe("quota");
  });

  it("classifies 500/502/503 as timeout (transient)", () => {
    for (const status of [500, 502, 503]) {
      const err = Object.assign(new Error("Server Error"), { status });
      expect(classifyFailoverReason(err)).toBe("timeout");
    }
  });

  // ── Error name ──────────────────────────────────────────────────

  it("classifies TimeoutError by name", () => {
    const err = new Error("timed out");
    err.name = "TimeoutError";
    expect(classifyFailoverReason(err)).toBe("timeout");
  });

  it("classifies AbortError by name", () => {
    const err = new Error("aborted");
    err.name = "AbortError";
    expect(classifyFailoverReason(err)).toBe("timeout");
  });

  // ── Message patterns ──────────────────────────────────────────

  it("classifies 'invalid api key' as auth", () => {
    expect(classifyFailoverReason(new Error("Invalid API key provided"))).toBe("auth");
  });

  it("classifies 'rate limit' message as rate_limit", () => {
    expect(classifyFailoverReason(new Error("Rate limit exceeded"))).toBe("rate_limit");
  });

  it("classifies 'overloaded' as rate_limit", () => {
    expect(classifyFailoverReason(new Error("API is currently overloaded"))).toBe("rate_limit");
  });

  it("classifies billing messages as billing", () => {
    expect(classifyFailoverReason(new Error("Insufficient funds in account"))).toBe("billing");
  });

  it("classifies ETIMEDOUT as timeout", () => {
    expect(classifyFailoverReason(new Error("connect ETIMEDOUT"))).toBe("timeout");
  });

  it("classifies ECONNRESET as timeout", () => {
    expect(classifyFailoverReason(new Error("read ECONNRESET"))).toBe("timeout");
  });

  it("classifies unknown errors as unknown", () => {
    expect(classifyFailoverReason(new Error("Something weird happened"))).toBe("unknown");
  });

  it("classifies non-Error values", () => {
    expect(classifyFailoverReason("rate limit exceeded")).toBe("rate_limit");
    expect(classifyFailoverReason(42)).toBe("unknown");
    expect(classifyFailoverReason(null)).toBe("unknown");
  });
});

describe("isRetriableFailoverReason", () => {
  it("auth is retriable", () => {
    expect(isRetriableFailoverReason("auth")).toBe(true);
  });

  it("rate_limit is retriable", () => {
    expect(isRetriableFailoverReason("rate_limit")).toBe(true);
  });

  it("billing is retriable", () => {
    expect(isRetriableFailoverReason("billing")).toBe(true);
  });

  it("timeout is retriable", () => {
    expect(isRetriableFailoverReason("timeout")).toBe(true);
  });

  it("unknown is not retriable", () => {
    expect(isRetriableFailoverReason("unknown")).toBe(false);
  });

  it("quota is not retriable", () => {
    expect(isRetriableFailoverReason("quota")).toBe(false);
  });
});

describe("FailoverError", () => {
  it("creates with reason and metadata", () => {
    const err = new FailoverError("rate_limit", "Rate limited", {
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      profileId: "primary",
      status: 429,
    });

    expect(err.name).toBe("FailoverError");
    expect(err.reason).toBe("rate_limit");
    expect(err.message).toBe("Rate limited");
    expect(err.provider).toBe("anthropic");
    expect(err.model).toBe("claude-sonnet-4-20250514");
    expect(err.profileId).toBe("primary");
    expect(err.status).toBe(429);
  });
});
