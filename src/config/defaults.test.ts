import { describe, it, expect } from "vitest";
import {
  applyAllDefaults,
  applyAgentDefaults,
  applyGatewayDefaults,
  applyLoggingDefaults,
  DEFAULT_MAX_ITERATIONS,
  DEFAULT_MAX_RETRIES,
  DEFAULT_MAX_TOOL_RESULT_CHARS,
  DEFAULT_LOG_LEVEL,
} from "./defaults.js";
import { DEFAULT_GATEWAY_PORT } from "./paths.js";
import type { MyClawConfig } from "./schema.js";

const minimalConfig: MyClawConfig = {
  provider: {
    name: "anthropic",
    model: "claude-sonnet-4-20250514",
    authProfiles: [{ id: "primary", apiKey: "sk-test" }],
  },
};

describe("applyGatewayDefaults", () => {
  it("adds default port when gateway is undefined", () => {
    const result = applyGatewayDefaults(minimalConfig);
    expect(result.gateway?.port).toBe(DEFAULT_GATEWAY_PORT);
  });

  it("preserves existing port", () => {
    const cfg: MyClawConfig = {
      ...minimalConfig,
      gateway: { port: 9000 },
    };
    const result = applyGatewayDefaults(cfg);
    expect(result.gateway?.port).toBe(9000);
  });
});

describe("applyAgentDefaults", () => {
  it("adds all agent defaults when agent is undefined", () => {
    const result = applyAgentDefaults(minimalConfig);
    expect(result.agent?.maxIterations).toBe(DEFAULT_MAX_ITERATIONS);
    expect(result.agent?.maxRetries).toBe(DEFAULT_MAX_RETRIES);
    expect(result.agent?.maxToolResultChars).toBe(DEFAULT_MAX_TOOL_RESULT_CHARS);
  });

  it("preserves explicitly set values", () => {
    const cfg: MyClawConfig = {
      ...minimalConfig,
      agent: { maxIterations: 10, maxRetries: 1, maxToolResultChars: 5000 },
    };
    const result = applyAgentDefaults(cfg);
    expect(result.agent?.maxIterations).toBe(10);
    expect(result.agent?.maxRetries).toBe(1);
    expect(result.agent?.maxToolResultChars).toBe(5000);
  });

  it("fills in only missing agent fields", () => {
    const cfg: MyClawConfig = {
      ...minimalConfig,
      agent: { maxIterations: 50 },
    };
    const result = applyAgentDefaults(cfg);
    expect(result.agent?.maxIterations).toBe(50);
    expect(result.agent?.maxRetries).toBe(DEFAULT_MAX_RETRIES);
  });
});

describe("applyLoggingDefaults", () => {
  it("adds defaults when logging is undefined", () => {
    const result = applyLoggingDefaults(minimalConfig);
    expect(result.logging?.level).toBe(DEFAULT_LOG_LEVEL);
    expect(result.logging?.redactSensitive).toBe(true);
  });

  it("preserves existing values", () => {
    const cfg: MyClawConfig = {
      ...minimalConfig,
      logging: { level: "debug", redactSensitive: false },
    };
    const result = applyLoggingDefaults(cfg);
    expect(result.logging?.level).toBe("debug");
    expect(result.logging?.redactSensitive).toBe(false);
  });
});

describe("applyAllDefaults", () => {
  it("applies all default chains", () => {
    const result = applyAllDefaults(minimalConfig);
    expect(result.gateway?.port).toBe(DEFAULT_GATEWAY_PORT);
    expect(result.agent?.maxIterations).toBe(DEFAULT_MAX_ITERATIONS);
    expect(result.logging?.level).toBe(DEFAULT_LOG_LEVEL);
  });

  it("does not mutate original config", () => {
    const original = { ...minimalConfig };
    applyAllDefaults(minimalConfig);
    expect(minimalConfig).toEqual(original);
  });
});
