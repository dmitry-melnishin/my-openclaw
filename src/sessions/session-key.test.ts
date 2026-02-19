import { describe, it, expect } from "vitest";
import {
  buildSessionKey,
  parseSessionKey,
  sessionKeyToSlug,
} from "./session-key.js";

// ── buildSessionKey ─────────────────────────────────────────────────

describe("buildSessionKey", () => {
  it("builds canonical key with defaults", () => {
    const key = buildSessionKey({
      channel: "telegram",
      peerKind: "direct",
      peerId: "user_123456",
    });
    expect(key).toBe(
      "agent:main:channel:telegram:account:default:peer:direct:user_123456",
    );
  });

  it("builds key with explicit agentId and accountId", () => {
    const key = buildSessionKey({
      agentId: "researcher",
      channel: "slack",
      accountId: "workspace-a",
      peerKind: "group",
      peerId: "C0123ABC",
    });
    expect(key).toBe(
      "agent:researcher:channel:slack:account:workspace-a:peer:group:c0123abc",
    );
  });

  it("normalises segments to lowercase", () => {
    const key = buildSessionKey({
      channel: "Telegram",
      peerKind: "direct",
      peerId: "User_ABC",
    });
    expect(key).toContain("channel:telegram");
    expect(key).toContain("peer:direct:user_abc");
  });

  it("replaces whitespace with underscores", () => {
    const key = buildSessionKey({
      channel: "my channel",
      peerKind: "group",
      peerId: "chat 789",
    });
    expect(key).toContain("channel:my_channel");
    expect(key).toContain("peer:group:chat_789");
  });

  it("falls back to 'unknown' for empty peerId", () => {
    const key = buildSessionKey({
      channel: "telegram",
      peerKind: "direct",
      peerId: "",
    });
    expect(key).toContain("peer:direct:unknown");
  });

  it("falls back to 'main' for empty agentId", () => {
    const key = buildSessionKey({
      agentId: "",
      channel: "telegram",
      peerKind: "direct",
      peerId: "u1",
    });
    expect(key.startsWith("agent:main:")).toBe(true);
  });

  it("handles channel peer kind", () => {
    const key = buildSessionKey({
      channel: "slack",
      peerKind: "channel",
      peerId: "general",
    });
    expect(key).toBe(
      "agent:main:channel:slack:account:default:peer:channel:general",
    );
  });

  it("strips unsafe characters", () => {
    const key = buildSessionKey({
      channel: "tele/gram",
      peerKind: "direct",
      peerId: "user<>123",
    });
    // forward slash and angle brackets should be stripped
    expect(key).toContain("channel:telegram");
    expect(key).toContain("peer:direct:user123");
  });

  it("is deterministic (same input → same output)", () => {
    const params = {
      channel: "telegram",
      peerKind: "direct" as const,
      peerId: "user_42",
    };
    expect(buildSessionKey(params)).toBe(buildSessionKey(params));
  });
});

// ── parseSessionKey ─────────────────────────────────────────────────

describe("parseSessionKey", () => {
  it("parses a valid canonical key", () => {
    const parsed = parseSessionKey(
      "agent:main:channel:telegram:account:default:peer:direct:user_123",
    );
    expect(parsed).toEqual({
      agentId: "main",
      channel: "telegram",
      accountId: "default",
      peerKind: "direct",
      peerId: "user_123",
    });
  });

  it("parses group peer kind", () => {
    const parsed = parseSessionKey(
      "agent:main:channel:slack:account:ws1:peer:group:C0123",
    );
    expect(parsed).toEqual({
      agentId: "main",
      channel: "slack",
      accountId: "ws1",
      peerKind: "group",
      peerId: "C0123",
    });
  });

  it("parses channel peer kind", () => {
    const parsed = parseSessionKey(
      "agent:main:channel:discord:account:default:peer:channel:general",
    );
    expect(parsed?.peerKind).toBe("channel");
  });

  it("returns null for invalid key format", () => {
    expect(parseSessionKey("garbage")).toBeNull();
    expect(parseSessionKey("agent:main")).toBeNull();
    expect(parseSessionKey("")).toBeNull();
  });

  it("round-trips with buildSessionKey", () => {
    const key = buildSessionKey({
      agentId: "bot",
      channel: "telegram",
      accountId: "prod",
      peerKind: "group",
      peerId: "chat_999",
    });
    const parsed = parseSessionKey(key);
    expect(parsed).toEqual({
      agentId: "bot",
      channel: "telegram",
      accountId: "prod",
      peerKind: "group",
      peerId: "chat_999",
    });
  });

  it("handles peerId containing colons", () => {
    // peerId is everything after the last "peer:<kind>:" match
    const parsed = parseSessionKey(
      "agent:main:channel:telegram:account:default:peer:direct:user:with:colons",
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.peerId).toBe("user:with:colons");
  });
});

// ── sessionKeyToSlug ────────────────────────────────────────────────

describe("sessionKeyToSlug", () => {
  it("replaces colons with double underscores", () => {
    expect(
      sessionKeyToSlug(
        "agent:main:channel:telegram:account:default:peer:direct:user_1",
      ),
    ).toBe(
      "agent__main__channel__telegram__account__default__peer__direct__user_1",
    );
  });

  it("produces a filesystem-safe string", () => {
    const slug = sessionKeyToSlug(
      "agent:main:channel:slack:account:ws:peer:group:C01",
    );
    // No colons, slashes, or spaces
    expect(slug).not.toContain(":");
    expect(slug).not.toContain("/");
    expect(slug).not.toContain(" ");
  });
});
