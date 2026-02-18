/**
 * Environment variable substitution for config values.
 *
 * Supports `${VAR_NAME}` syntax in string values, substituted at config load time.
 * - Only uppercase env vars are matched: `[A-Z_][A-Z0-9_]*`
 * - Escape with `$${VAR}` to output literal `${VAR}`
 * - Missing env vars throw `MissingEnvVarError` with context path
 *
 * @example
 * ```json5
 * {
 *   provider: {
 *     authProfiles: [
 *       { id: "primary", apiKey: "${ANTHROPIC_API_KEY}" },
 *     ],
 *   },
 * }
 * ```
 */

/** Pattern for valid uppercase env var names. */
const ENV_VAR_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

// ── Error ───────────────────────────────────────────────────────────

export class MissingEnvVarError extends Error {
  constructor(
    public readonly varName: string,
    public readonly configPath: string,
  ) {
    super(`Missing env var "${varName}" referenced at config path: ${configPath}`);
    this.name = "MissingEnvVarError";
  }
}

// ── String substitution ─────────────────────────────────────────────

function substituteString(
  value: string,
  env: NodeJS.ProcessEnv,
  configPath: string,
): string {
  if (!value.includes("$")) return value;

  const chunks: string[] = [];

  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (char !== "$") {
      chunks.push(char);
      continue;
    }

    const next = value[i + 1];
    const afterNext = value[i + 2];

    // Escaped: $${VAR} → literal ${VAR}
    if (next === "$" && afterNext === "{") {
      const start = i + 3;
      const end = value.indexOf("}", start);
      if (end !== -1) {
        const name = value.slice(start, end);
        if (ENV_VAR_NAME_PATTERN.test(name)) {
          chunks.push(`\${${name}}`);
          i = end;
          continue;
        }
      }
    }

    // Substitution: ${VAR} → env value
    if (next === "{") {
      const start = i + 2;
      const end = value.indexOf("}", start);
      if (end !== -1) {
        const name = value.slice(start, end);
        if (ENV_VAR_NAME_PATTERN.test(name)) {
          const envValue = env[name];
          if (envValue === undefined || envValue === "") {
            throw new MissingEnvVarError(name, configPath);
          }
          chunks.push(envValue);
          i = end;
          continue;
        }
      }
    }

    // Not a recognized pattern — pass through
    chunks.push(char);
  }

  return chunks.join("");
}

// ── Helpers ─────────────────────────────────────────────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Check if a string contains any `${VAR}` references (without substituting).
 */
export function containsEnvVarReference(value: string): boolean {
  if (!value.includes("$")) return false;

  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (char !== "$") continue;

    const next = value[i + 1];
    const afterNext = value[i + 2];

    // Skip escaped: $${VAR}
    if (next === "$" && afterNext === "{") {
      const start = i + 3;
      const end = value.indexOf("}", start);
      if (end !== -1) {
        const name = value.slice(start, end);
        if (ENV_VAR_NAME_PATTERN.test(name)) {
          i = end;
          continue;
        }
      }
    }

    // Substitution pattern
    if (next === "{") {
      const start = i + 2;
      const end = value.indexOf("}", start);
      if (end !== -1) {
        const name = value.slice(start, end);
        if (ENV_VAR_NAME_PATTERN.test(name)) {
          return true;
        }
      }
    }
  }

  return false;
}

// ── Deep walk ───────────────────────────────────────────────────────

function substituteAny(
  value: unknown,
  env: NodeJS.ProcessEnv,
  path: string,
): unknown {
  if (typeof value === "string") {
    return substituteString(value, env, path);
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => substituteAny(item, env, `${path}[${index}]`));
  }

  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      const childPath = path ? `${path}.${key}` : key;
      result[key] = substituteAny(val, env, childPath);
    }
    return result;
  }

  // Primitives (number, boolean, null) pass through unchanged
  return value;
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Resolve `${VAR_NAME}` environment variable references in config values.
 *
 * @param obj - Parsed config object (after JSON5 parse)
 * @param env - Environment variables to use for substitution (defaults to process.env)
 * @returns Config object with env vars substituted
 * @throws {MissingEnvVarError} If a referenced env var is not set or empty
 */
export function resolveConfigEnvVars(
  obj: unknown,
  env: NodeJS.ProcessEnv = process.env,
): unknown {
  return substituteAny(obj, env, "");
}
