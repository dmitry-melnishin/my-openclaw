import { describe, it, expect } from "vitest";
import { MyClawConfigSchema } from "./schema.js";

describe("MyClawConfigSchema", () => {
  const validConfig = {
    provider: {
      name: "anthropic",
      model: "claude-sonnet-4-20250514",
      authProfiles: [{ id: "primary", apiKey: "sk-test-123" }],
    },
  };

  it("accepts a minimal valid config", () => {
    const result = MyClawConfigSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
  });

  it("accepts a full config", () => {
    const full = {
      provider: {
        name: "anthropic",
        model: "claude-sonnet-4-20250514",
        authProfiles: [
          { id: "primary", apiKey: "sk-test-123" },
          { id: "fallback", apiKey: "sk-test-456" },
        ],
      },
      channels: {
        telegram: {
          botToken: "tg-token-789",
          allowedChatIds: ["123", 456],
        },
      },
      gateway: {
        port: 9000,
        token: "gw-secret",
      },
      agent: {
        workspaceDir: "~/.myclaw/workspace",
        maxIterations: 30,
        maxRetries: 5,
        maxToolResultChars: 100000,
      },
      logging: {
        level: "debug",
        redactSensitive: false,
      },
    };
    const result = MyClawConfigSchema.safeParse(full);
    expect(result.success).toBe(true);
  });

  it("requires provider field", () => {
    const result = MyClawConfigSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("requires at least one auth profile", () => {
    const result = MyClawConfigSchema.safeParse({
      provider: {
        name: "anthropic",
        model: "claude-sonnet-4-20250514",
        authProfiles: [],
      },
    });
    expect(result.success).toBe(false);
  });

  it("requires auth profile id and apiKey", () => {
    const result = MyClawConfigSchema.safeParse({
      provider: {
        name: "anthropic",
        model: "claude-sonnet-4-20250514",
        authProfiles: [{ id: "" }],
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown top-level keys (strict)", () => {
    const result = MyClawConfigSchema.safeParse({
      ...validConfig,
      unknownField: "should fail",
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown provider keys (strict)", () => {
    const result = MyClawConfigSchema.safeParse({
      provider: {
        ...validConfig.provider,
        extraField: true,
      },
    });
    expect(result.success).toBe(false);
  });

  it("validates gateway port is positive integer", () => {
    const result = MyClawConfigSchema.safeParse({
      ...validConfig,
      gateway: { port: -1 },
    });
    expect(result.success).toBe(false);
  });

  it("validates logging level enum", () => {
    const result = MyClawConfigSchema.safeParse({
      ...validConfig,
      logging: { level: "verbose" },
    });
    expect(result.success).toBe(false);
  });

  it("accepts optional baseUrl on provider", () => {
    const result = MyClawConfigSchema.safeParse({
      provider: {
        ...validConfig.provider,
        baseUrl: "https://proxy.example.com/v1",
      },
    });
    expect(result.success).toBe(true);
  });
});
