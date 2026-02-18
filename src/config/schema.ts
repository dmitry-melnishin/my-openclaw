/**
 * Zod schema for the MyClaw config file (~/.myclaw/myclaw.json).
 *
 * Uses `.strict()` on objects to reject unknown keys early.
 * Sensitive fields (API keys, tokens) are tagged via `.describe("sensitive")`
 * so downstream code can redact them in logs/UI.
 */

import { z } from "zod";

// ── Auth profile ────────────────────────────────────────────────────

export const AuthProfileSchema = z
  .object({
    /** Unique profile identifier, e.g. "primary", "fallback". */
    id: z.string().min(1),
    /** API key (may contain `${VAR}` before env substitution). */
    apiKey: z.string().min(1).describe("sensitive"),
  })
  .strict();

export type AuthProfile = z.infer<typeof AuthProfileSchema>;

// ── Provider ────────────────────────────────────────────────────────

export const ProviderSchema = z
  .object({
    /** Provider identifier: "anthropic" | "openai" | "google" | "ollama" etc. */
    name: z.string().min(1),
    /** Model identifier, e.g. "claude-sonnet-4-20250514". */
    model: z.string().min(1),
    /** Auth profiles for failover rotation. At least one required. */
    authProfiles: z.array(AuthProfileSchema).min(1),
    /** Optional base URL override (for proxies / self-hosted). */
    baseUrl: z.string().url().optional(),
  })
  .strict();

export type ProviderConfig = z.infer<typeof ProviderSchema>;

// ── Telegram channel ────────────────────────────────────────────────

export const TelegramChannelSchema = z
  .object({
    botToken: z.string().min(1).describe("sensitive"),
    /** Optional: only respond in these chat IDs (allowlist). */
    allowedChatIds: z.array(z.union([z.string(), z.number()])).optional(),
  })
  .strict();

export type TelegramChannelConfig = z.infer<typeof TelegramChannelSchema>;

// ── Channels ────────────────────────────────────────────────────────

export const ChannelsSchema = z
  .object({
    telegram: TelegramChannelSchema.optional(),
  })
  .strict();

export type ChannelsConfig = z.infer<typeof ChannelsSchema>;

// ── Gateway ─────────────────────────────────────────────────────────

export const GatewaySchema = z
  .object({
    /** HTTP/WS listen port. Default: 18789. */
    port: z.number().int().positive().optional(),
    /** Shared-secret token for gateway auth. */
    token: z.string().min(1).describe("sensitive").optional(),
  })
  .strict();

export type GatewayConfig = z.infer<typeof GatewaySchema>;

// ── Agent ───────────────────────────────────────────────────────────

export const AgentSchema = z
  .object({
    /** Agent workspace directory. Default: ~/.myclaw/workspace */
    workspaceDir: z.string().optional(),
    /** Max tool-call iterations per run. Default: 25. */
    maxIterations: z.number().int().positive().optional(),
    /** Max retries per LLM call (for failover). Default: 3. */
    maxRetries: z.number().int().nonnegative().optional(),
    /** Max characters in a single tool result. Default: 50000. */
    maxToolResultChars: z.number().int().positive().optional(),
  })
  .strict();

export type AgentConfig = z.infer<typeof AgentSchema>;

// ── Logging ─────────────────────────────────────────────────────────

export const LoggingSchema = z
  .object({
    /** Log level. Default: "info". */
    level: z.enum(["debug", "info", "warn", "error"]).optional(),
    /** Redact sensitive values in logs. Default: true. */
    redactSensitive: z.boolean().optional(),
  })
  .strict();

export type LoggingConfig = z.infer<typeof LoggingSchema>;

// ── Root config ─────────────────────────────────────────────────────

export const MyClawConfigSchema = z
  .object({
    provider: ProviderSchema,
    channels: ChannelsSchema.optional(),
    gateway: GatewaySchema.optional(),
    agent: AgentSchema.optional(),
    logging: LoggingSchema.optional(),
  })
  .strict();

export type MyClawConfig = z.infer<typeof MyClawConfigSchema>;
