/**
 * Config loader — the main entry point for the config layer.
 *
 * Pipeline: read file → JSON5 parse → env-var substitution → Zod validation → apply defaults → cache.
 *
 * Uses a short-lived cache (200ms default) so repeated calls in the same
 * request cycle don't re-read the file.
 */

import JSON5 from "json5";
import fs from "node:fs";
import path from "node:path";

import { applyAllDefaults } from "./defaults.js";
import { resolveConfigEnvVars, MissingEnvVarError } from "./env-substitution.js";
import { resolveConfigPath, resolveStateDir, ensureDir } from "./paths.js";
import { MyClawConfigSchema, type MyClawConfig } from "./schema.js";

export { MissingEnvVarError } from "./env-substitution.js";

// ── Types ───────────────────────────────────────────────────────────

export type LoadConfigOptions = {
  /** Override config file path. */
  configPath?: string;
  /** Override env vars for `${VAR}` substitution. */
  env?: NodeJS.ProcessEnv;
  /** Skip cache and force re-read. */
  noCache?: boolean;
};

export type ConfigResult = {
  /** Fully validated and defaulted config. */
  config: MyClawConfig;
  /** Resolved file path that was loaded. */
  path: string;
};

// ── Cache ───────────────────────────────────────────────────────────

const CACHE_TTL_MS = 200;

let cachedResult: ConfigResult | null = null;
let cachedAt = 0;
let cachedPath = "";

/** Clear the in-memory config cache (useful for tests). */
export function clearConfigCache(): void {
  cachedResult = null;
  cachedAt = 0;
  cachedPath = "";
}

// ── Loader ──────────────────────────────────────────────────────────

/**
 * Load, validate, and cache the MyClaw config.
 *
 * @returns Typed, validated config object with defaults applied.
 * @throws If the config file is missing, malformed, or fails validation.
 */
export function loadConfig(options: LoadConfigOptions = {}): ConfigResult {
  const env = options.env ?? process.env;
  const configPath = options.configPath ?? resolveConfigPath(env);

  // Check cache
  if (
    !options.noCache &&
    cachedResult &&
    cachedPath === configPath &&
    Date.now() - cachedAt < CACHE_TTL_MS
  ) {
    return cachedResult;
  }

  // 1. Read raw file
  const resolvedPath = path.resolve(configPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new ConfigFileNotFoundError(resolvedPath);
  }

  const raw = fs.readFileSync(resolvedPath, "utf-8");

  // 2. Parse JSON5
  let parsed: unknown;
  try {
    parsed = JSON5.parse(raw);
  } catch (err) {
    throw new ConfigParseError(
      resolvedPath,
      err instanceof Error ? err.message : String(err),
    );
  }

  // 3. Env-var substitution
  let substituted: unknown;
  try {
    substituted = resolveConfigEnvVars(parsed, env);
  } catch (err) {
    if (err instanceof MissingEnvVarError) throw err;
    throw new ConfigEnvSubstitutionError(
      resolvedPath,
      err instanceof Error ? err.message : String(err),
    );
  }

  // 4. Zod validation
  const result = MyClawConfigSchema.safeParse(substituted);
  if (!result.success) {
    throw new ConfigValidationError(resolvedPath, result.error.issues);
  }

  // 5. Apply defaults
  const config = applyAllDefaults(result.data);

  // 6. Cache
  const configResult: ConfigResult = { config, path: resolvedPath };
  cachedResult = configResult;
  cachedAt = Date.now();
  cachedPath = configPath;

  return configResult;
}

// ── Scaffold ────────────────────────────────────────────────────────

/**
 * Create a default config file if none exists.
 * Returns the path to the (possibly newly created) config file.
 */
export function scaffoldConfigIfMissing(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const stateDir = resolveStateDir(env);
  const configPath = resolveConfigPath(env, stateDir);

  if (fs.existsSync(configPath)) return configPath;

  ensureDir(stateDir);

  const template = `// MyClaw configuration — https://github.com/dmitry-melnishin/my-openclaw
{
  provider: {
    name: "anthropic",
    model: "claude-sonnet-4-20250514",
    authProfiles: [
      { id: "primary", apiKey: "\${ANTHROPIC_API_KEY}" },
    ],
  },

  // channels: {
  //   telegram: {
  //     botToken: "\${TELEGRAM_BOT_TOKEN}",
  //   },
  // },

  // gateway: {
  //   port: 18789,
  //   token: "\${GATEWAY_TOKEN}",
  // },

  // agent: {
  //   workspaceDir: "~/.myclaw/workspace",
  // },
}
`;

  fs.writeFileSync(configPath, template, "utf-8");
  return configPath;
}

// ── Error classes ───────────────────────────────────────────────────

export class ConfigFileNotFoundError extends Error {
  constructor(public readonly filePath: string) {
    super(`Config file not found: ${filePath}`);
    this.name = "ConfigFileNotFoundError";
  }
}

export class ConfigParseError extends Error {
  constructor(
    public readonly filePath: string,
    public readonly parseError: string,
  ) {
    super(`Failed to parse config file ${filePath}: ${parseError}`);
    this.name = "ConfigParseError";
  }
}

export class ConfigEnvSubstitutionError extends Error {
  constructor(
    public readonly filePath: string,
    public readonly detail: string,
  ) {
    super(`Env substitution failed for ${filePath}: ${detail}`);
    this.name = "ConfigEnvSubstitutionError";
  }
}

export class ConfigValidationError extends Error {
  constructor(
    public readonly filePath: string,
    public readonly issues: Array<{ path: PropertyKey[]; message: string }>,
  ) {
    const summary = issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    super(`Config validation failed for ${filePath}:\n${summary}`);
    this.name = "ConfigValidationError";
  }
}
