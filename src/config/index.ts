/**
 * Config layer — public API.
 *
 * @example
 * ```ts
 * import { loadConfig } from "./config/index.js";
 *
 * const { config, path } = loadConfig();
 * console.log(config.provider.name);       // "anthropic"
 * console.log(config.provider.authProfiles); // [{ id: "primary", apiKey: "sk-..." }]
 * ```
 */

export {
  loadConfig,
  clearConfigCache,
  scaffoldConfigIfMissing,
  ConfigFileNotFoundError,
  ConfigParseError,
  ConfigEnvSubstitutionError,
  ConfigValidationError,
  MissingEnvVarError,
  type LoadConfigOptions,
  type ConfigResult,
} from "./loader.js";

export {
  MyClawConfigSchema,
  type MyClawConfig,
  type AuthProfile,
  type ProviderConfig,
  type TelegramChannelConfig,
  type ChannelsConfig,
  type GatewayConfig,
  type AgentConfig,
  type LoggingConfig,
} from "./schema.js";

export {
  resolveStateDir,
  resolveConfigPath,
  resolveWorkspaceDir,
  resolveSessionsDir,
  resolveLogsDir,
  resolveGatewayPort,
  ensureDir,
  STATE_DIR,
  CONFIG_PATH,
  DEFAULT_GATEWAY_PORT,
} from "./paths.js";

export {
  resolveConfigEnvVars,
  containsEnvVarReference,
} from "./env-substitution.js";

export {
  applyAllDefaults,
  applyAgentDefaults,
  applyGatewayDefaults,
  applyLoggingDefaults,
  DEFAULT_MODEL,
  DEFAULT_MAX_ITERATIONS,
  DEFAULT_MAX_RETRIES,
  DEFAULT_MAX_TOOL_RESULT_CHARS,
  DEFAULT_LOG_LEVEL,
} from "./defaults.js";
