/**
 * Default values for all config keys.
 *
 * Each `apply*Defaults()` function returns a **new** config object
 * with defaults merged in (no mutation). They are composed in a chain
 * by `applyAllDefaults()`.
 */

import type { MyClawConfig } from "./schema.js";
import { DEFAULT_GATEWAY_PORT } from "./paths.js";

// ── Constants ───────────────────────────────────────────────────────

export const DEFAULT_MODEL = "claude-sonnet-4-20250514";
export const DEFAULT_MAX_ITERATIONS = 25;
export const DEFAULT_MAX_RETRIES = 3;
export const DEFAULT_MAX_TOOL_RESULT_CHARS = 50_000;
export const DEFAULT_LOG_LEVEL = "info" as const;

// ── Agent defaults ──────────────────────────────────────────────────

export function applyAgentDefaults(cfg: MyClawConfig): MyClawConfig {
  const agent = cfg.agent;
  const needsDefaults =
    !agent ||
    agent.maxIterations === undefined ||
    agent.maxRetries === undefined ||
    agent.maxToolResultChars === undefined;

  if (!needsDefaults) return cfg;

  return {
    ...cfg,
    agent: {
      ...agent,
      maxIterations: agent?.maxIterations ?? DEFAULT_MAX_ITERATIONS,
      maxRetries: agent?.maxRetries ?? DEFAULT_MAX_RETRIES,
      maxToolResultChars: agent?.maxToolResultChars ?? DEFAULT_MAX_TOOL_RESULT_CHARS,
    },
  };
}

// ── Gateway defaults ────────────────────────────────────────────────

export function applyGatewayDefaults(cfg: MyClawConfig): MyClawConfig {
  const gw = cfg.gateway;
  if (gw?.port !== undefined) return cfg;

  return {
    ...cfg,
    gateway: {
      ...gw,
      port: DEFAULT_GATEWAY_PORT,
    },
  };
}

// ── Logging defaults ────────────────────────────────────────────────

export function applyLoggingDefaults(cfg: MyClawConfig): MyClawConfig {
  const logging = cfg.logging;
  const needsDefaults =
    !logging ||
    logging.level === undefined ||
    logging.redactSensitive === undefined;

  if (!needsDefaults) return cfg;

  return {
    ...cfg,
    logging: {
      level: logging?.level ?? DEFAULT_LOG_LEVEL,
      redactSensitive: logging?.redactSensitive ?? true,
    },
  };
}

// ── Compose all defaults ────────────────────────────────────────────

/**
 * Apply all default chains to a validated config.
 * Order matters: gateway → agent → logging.
 */
export function applyAllDefaults(cfg: MyClawConfig): MyClawConfig {
  return applyLoggingDefaults(applyAgentDefaults(applyGatewayDefaults(cfg)));
}
