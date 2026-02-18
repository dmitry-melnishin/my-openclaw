import { describe, it, expect } from "vitest";
import path from "node:path";
import os from "node:os";
import {
  resolveStateDir,
  resolveConfigPath,
  resolveWorkspaceDir,
  resolveSessionsDir,
  resolveLogsDir,
  resolveGatewayPort,
  DEFAULT_GATEWAY_PORT,
} from "./paths.js";

describe("resolveStateDir", () => {
  it("defaults to ~/.myclaw", () => {
    const env = {} as NodeJS.ProcessEnv;
    const dir = resolveStateDir(env);
    expect(dir).toBe(path.join(os.homedir(), ".myclaw"));
  });

  it("respects MYCLAW_STATE_DIR override", () => {
    const env = { MYCLAW_STATE_DIR: "/tmp/test-state" } as NodeJS.ProcessEnv;
    const dir = resolveStateDir(env);
    expect(path.resolve(dir)).toBe(path.resolve("/tmp/test-state"));
  });

  it("expands ~ in MYCLAW_STATE_DIR", () => {
    const env = { MYCLAW_STATE_DIR: "~/custom-state" } as NodeJS.ProcessEnv;
    const dir = resolveStateDir(env);
    expect(dir).toBe(path.join(os.homedir(), "custom-state"));
  });

  it("respects MYCLAW_HOME for ~ resolution", () => {
    const env = {
      MYCLAW_HOME: "/custom/home",
    } as NodeJS.ProcessEnv;
    const dir = resolveStateDir(env);
    expect(dir).toBe(path.join("/custom/home", ".myclaw"));
  });
});

describe("resolveConfigPath", () => {
  it("defaults to stateDir/myclaw.json", () => {
    const env = {} as NodeJS.ProcessEnv;
    const p = resolveConfigPath(env);
    expect(p).toBe(path.join(os.homedir(), ".myclaw", "myclaw.json"));
  });

  it("respects MYCLAW_CONFIG_PATH override", () => {
    const env = { MYCLAW_CONFIG_PATH: "/etc/myclaw.json" } as NodeJS.ProcessEnv;
    const p = resolveConfigPath(env);
    expect(path.resolve(p)).toBe(path.resolve("/etc/myclaw.json"));
  });

  it("uses custom stateDir when provided", () => {
    const env = {} as NodeJS.ProcessEnv;
    const p = resolveConfigPath(env, "/tmp/custom-state");
    expect(p).toBe(path.join("/tmp/custom-state", "myclaw.json"));
  });
});

describe("resolveWorkspaceDir", () => {
  it("defaults to stateDir/workspace", () => {
    const dir = resolveWorkspaceDir(undefined, {} as NodeJS.ProcessEnv);
    expect(dir).toBe(path.join(os.homedir(), ".myclaw", "workspace"));
  });

  it("uses override when provided", () => {
    const dir = resolveWorkspaceDir("~/my-workspace");
    expect(dir).toBe(path.join(os.homedir(), "my-workspace"));
  });
});

describe("resolveSessionsDir", () => {
  it("returns stateDir/sessions", () => {
    expect(resolveSessionsDir("/tmp/state")).toBe(path.join("/tmp/state", "sessions"));
  });
});

describe("resolveLogsDir", () => {
  it("returns stateDir/logs", () => {
    expect(resolveLogsDir("/tmp/state")).toBe(path.join("/tmp/state", "logs"));
  });
});

describe("resolveGatewayPort", () => {
  it("defaults to DEFAULT_GATEWAY_PORT", () => {
    expect(resolveGatewayPort(undefined, {} as NodeJS.ProcessEnv)).toBe(DEFAULT_GATEWAY_PORT);
  });

  it("prefers env var over config", () => {
    const env = { MYCLAW_GATEWAY_PORT: "9999" } as NodeJS.ProcessEnv;
    expect(resolveGatewayPort(8080, env)).toBe(9999);
  });

  it("uses config when env not set", () => {
    expect(resolveGatewayPort(8080, {} as NodeJS.ProcessEnv)).toBe(8080);
  });

  it("ignores invalid env var", () => {
    const env = { MYCLAW_GATEWAY_PORT: "abc" } as NodeJS.ProcessEnv;
    expect(resolveGatewayPort(8080, env)).toBe(8080);
  });
});
