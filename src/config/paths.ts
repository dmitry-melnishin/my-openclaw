/**
 * Standard directory and config path resolution.
 *
 * State dir:  ~/.myclaw/          (mutable data: sessions, logs, caches)
 * Config:     ~/.myclaw/myclaw.json
 *
 * Override via env vars:
 *   MYCLAW_STATE_DIR   — override state directory
 *   MYCLAW_CONFIG_PATH — override config file path
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const STATE_DIRNAME = ".myclaw";
const CONFIG_FILENAME = "myclaw.json";

// ── Home directory ──────────────────────────────────────────────────

function resolveHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.MYCLAW_HOME?.trim();
  if (override) return override;
  return os.homedir();
}

// ── Tilde expansion ─────────────────────────────────────────────────

function expandTilde(filepath: string, home: string): string {
  if (filepath === "~") return home;
  if (filepath.startsWith("~/") || filepath.startsWith("~\\")) {
    return path.join(home, filepath.slice(2));
  }
  return filepath;
}

function resolveUserPath(input: string, env: NodeJS.ProcessEnv = process.env): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  const expanded = expandTilde(trimmed, resolveHomeDir(env));
  return path.resolve(expanded);
}

// ── State directory ─────────────────────────────────────────────────

/**
 * Resolve the state directory for mutable data.
 *
 * Override: `MYCLAW_STATE_DIR` env var.
 * Default:  `~/.myclaw`
 */
export function resolveStateDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.MYCLAW_STATE_DIR?.trim();
  if (override) return resolveUserPath(override, env);
  return path.join(resolveHomeDir(env), STATE_DIRNAME);
}

/** Module-level constant — evaluated once at import. */
export const STATE_DIR = resolveStateDir();

// ── Config file path ────────────────────────────────────────────────

/**
 * Resolve the config file path (JSON5).
 *
 * Override: `MYCLAW_CONFIG_PATH` env var.
 * Default:  `~/.myclaw/myclaw.json`
 */
export function resolveConfigPath(
  env: NodeJS.ProcessEnv = process.env,
  stateDir: string = resolveStateDir(env),
): string {
  const override = env.MYCLAW_CONFIG_PATH?.trim();
  if (override) return resolveUserPath(override, env);
  return path.join(stateDir, CONFIG_FILENAME);
}

/** Module-level constant — evaluated once at import. */
export const CONFIG_PATH = resolveConfigPath();

// ── Workspace directory ─────────────────────────────────────────────

/**
 * Resolve workspace directory (agent sandbox).
 */
export function resolveWorkspaceDir(
  workspaceOverride?: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (workspaceOverride) return resolveUserPath(workspaceOverride, env);
  return path.join(resolveStateDir(env), "workspace");
}

// ── Sessions directory ──────────────────────────────────────────────

/** Directory for session transcripts and metadata. */
export function resolveSessionsDir(stateDir: string = resolveStateDir()): string {
  return path.join(stateDir, "sessions");
}

// ── Logs directory ──────────────────────────────────────────────────

/** Directory for log files. */
export function resolveLogsDir(stateDir: string = resolveStateDir()): string {
  return path.join(stateDir, "logs");
}

// ── Ensure dirs ─────────────────────────────────────────────────────

/**
 * Ensure a directory exists, creating it recursively if needed.
 */
export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// ── Gateway port ────────────────────────────────────────────────────

export const DEFAULT_GATEWAY_PORT = 18789;

/**
 * Resolve the gateway port.
 * Priority: env `MYCLAW_GATEWAY_PORT` → config → default.
 */
export function resolveGatewayPort(
  configPort?: number,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const envRaw = env.MYCLAW_GATEWAY_PORT?.trim();
  if (envRaw) {
    const parsed = Number.parseInt(envRaw, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  if (typeof configPort === "number" && Number.isFinite(configPort) && configPort > 0) {
    return configPort;
  }
  return DEFAULT_GATEWAY_PORT;
}
