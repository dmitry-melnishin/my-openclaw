import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  loadConfig,
  clearConfigCache,
  scaffoldConfigIfMissing,
  ConfigFileNotFoundError,
  ConfigParseError,
  ConfigValidationError,
  MissingEnvVarError,
} from "./loader.js";
import { DEFAULT_GATEWAY_PORT } from "./paths.js";
import { DEFAULT_MAX_ITERATIONS, DEFAULT_LOG_LEVEL } from "./defaults.js";

// ── Test helpers ────────────────────────────────────────────────────

let tmpDir: string;

function writeTmpConfig(content: string, filename = "myclaw.json"): string {
  const filePath = path.join(tmpDir, filename);
  fs.writeFileSync(filePath, content, "utf-8");
  return filePath;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "myclaw-test-"));
  clearConfigCache();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Tests ───────────────────────────────────────────────────────────

describe("loadConfig", () => {
  it("loads and validates a minimal JSON5 config", () => {
    const configPath = writeTmpConfig(`{
      // This is a JSON5 comment
      provider: {
        name: "anthropic",
        model: "claude-sonnet-4-20250514",
        authProfiles: [
          { id: "primary", apiKey: "sk-test-123" },
        ],
      },
    }`);

    const { config } = loadConfig({ configPath });
    expect(config.provider.name).toBe("anthropic");
    expect(config.provider.model).toBe("claude-sonnet-4-20250514");
    expect(config.provider.authProfiles).toHaveLength(1);
    expect(config.provider.authProfiles[0].apiKey).toBe("sk-test-123");
  });

  it("applies defaults after validation", () => {
    const configPath = writeTmpConfig(`{
      provider: {
        name: "openai",
        model: "gpt-4o",
        authProfiles: [{ id: "main", apiKey: "sk-openai" }],
      },
    }`);

    const { config } = loadConfig({ configPath });
    expect(config.gateway?.port).toBe(DEFAULT_GATEWAY_PORT);
    expect(config.agent?.maxIterations).toBe(DEFAULT_MAX_ITERATIONS);
    expect(config.logging?.level).toBe(DEFAULT_LOG_LEVEL);
    expect(config.logging?.redactSensitive).toBe(true);
  });

  it("substitutes ${VAR} from env", () => {
    const configPath = writeTmpConfig(`{
      provider: {
        name: "anthropic",
        model: "claude-sonnet-4-20250514",
        authProfiles: [
          { id: "primary", apiKey: "\${TEST_API_KEY}" },
        ],
      },
    }`);

    const env = { TEST_API_KEY: "sk-from-env" } as NodeJS.ProcessEnv;
    const { config } = loadConfig({ configPath, env });
    expect(config.provider.authProfiles[0].apiKey).toBe("sk-from-env");
  });

  it("throws MissingEnvVarError for unset env vars", () => {
    const configPath = writeTmpConfig(`{
      provider: {
        name: "anthropic",
        model: "claude-sonnet-4-20250514",
        authProfiles: [
          { id: "primary", apiKey: "\${TOTALLY_MISSING_VAR}" },
        ],
      },
    }`);

    expect(() => loadConfig({ configPath, env: {} as NodeJS.ProcessEnv })).toThrow(
      MissingEnvVarError,
    );
  });

  it("throws ConfigFileNotFoundError for missing file", () => {
    expect(() =>
      loadConfig({ configPath: "/nonexistent/path/myclaw.json" }),
    ).toThrow(ConfigFileNotFoundError);
  });

  it("throws ConfigParseError for invalid JSON5", () => {
    const configPath = writeTmpConfig("{ this is not valid json5 !!!");
    expect(() => loadConfig({ configPath })).toThrow(ConfigParseError);
  });

  it("throws ConfigValidationError for invalid schema", () => {
    const configPath = writeTmpConfig(`{ provider: { name: 123 } }`);
    expect(() => loadConfig({ configPath })).toThrow(ConfigValidationError);
  });

  it("throws ConfigValidationError for unknown keys (strict)", () => {
    const configPath = writeTmpConfig(`{
      provider: {
        name: "anthropic",
        model: "claude-sonnet-4-20250514",
        authProfiles: [{ id: "p", apiKey: "k" }],
      },
      unknownKey: true,
    }`);
    expect(() => loadConfig({ configPath })).toThrow(ConfigValidationError);
  });

  it("caches config for short TTL", () => {
    const configPath = writeTmpConfig(`{
      provider: {
        name: "anthropic",
        model: "claude-sonnet-4-20250514",
        authProfiles: [{ id: "p", apiKey: "k" }],
      },
    }`);

    const first = loadConfig({ configPath });
    const second = loadConfig({ configPath });
    expect(first).toBe(second); // same reference = cached
  });

  it("bypasses cache with noCache: true", () => {
    const configPath = writeTmpConfig(`{
      provider: {
        name: "anthropic",
        model: "claude-sonnet-4-20250514",
        authProfiles: [{ id: "p", apiKey: "k" }],
      },
    }`);

    const first = loadConfig({ configPath });
    const second = loadConfig({ configPath, noCache: true });
    expect(first).not.toBe(second); // different reference
    expect(first.config).toEqual(second.config); // same content
  });

  it("handles config with all optional sections", () => {
    const configPath = writeTmpConfig(`{
      provider: {
        name: "anthropic",
        model: "claude-sonnet-4-20250514",
        authProfiles: [{ id: "p", apiKey: "k" }],
      },
      channels: {
        telegram: {
          botToken: "tg-token",
        },
      },
      gateway: {
        port: 9000,
        token: "gw-secret",
      },
      agent: {
        workspaceDir: "~/workspace",
        maxIterations: 50,
      },
      logging: {
        level: "debug",
      },
    }`);

    const { config } = loadConfig({ configPath });
    expect(config.channels?.telegram?.botToken).toBe("tg-token");
    expect(config.gateway?.port).toBe(9000);
    expect(config.gateway?.token).toBe("gw-secret");
    expect(config.agent?.workspaceDir).toBe("~/workspace");
    expect(config.agent?.maxIterations).toBe(50);
    expect(config.logging?.level).toBe("debug");
  });

  it("handles multiple auth profiles for failover", () => {
    const configPath = writeTmpConfig(`{
      provider: {
        name: "anthropic",
        model: "claude-sonnet-4-20250514",
        authProfiles: [
          { id: "primary", apiKey: "sk-primary" },
          { id: "fallback", apiKey: "sk-fallback" },
          { id: "backup", apiKey: "sk-backup" },
        ],
      },
    }`);

    const { config } = loadConfig({ configPath });
    expect(config.provider.authProfiles).toHaveLength(3);
    expect(config.provider.authProfiles[0].id).toBe("primary");
    expect(config.provider.authProfiles[1].id).toBe("fallback");
    expect(config.provider.authProfiles[2].id).toBe("backup");
  });
});

describe("scaffoldConfigIfMissing", () => {
  it("creates a default config file", () => {
    const env = { MYCLAW_STATE_DIR: tmpDir } as NodeJS.ProcessEnv;
    const configPath = scaffoldConfigIfMissing(env);
    expect(fs.existsSync(configPath)).toBe(true);

    const content = fs.readFileSync(configPath, "utf-8");
    expect(content).toContain("provider");
    expect(content).toContain("authProfiles");
    expect(content).toContain("ANTHROPIC_API_KEY");
  });

  it("does not overwrite existing config", () => {
    const existingPath = writeTmpConfig("{ existing: true }");
    const env = {
      MYCLAW_STATE_DIR: tmpDir,
      MYCLAW_CONFIG_PATH: existingPath,
    } as NodeJS.ProcessEnv;

    scaffoldConfigIfMissing(env);
    const content = fs.readFileSync(existingPath, "utf-8");
    expect(content).toBe("{ existing: true }");
  });
});
