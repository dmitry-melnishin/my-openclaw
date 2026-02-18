import { describe, it, expect } from "vitest";
import {
  resolveConfigEnvVars,
  containsEnvVarReference,
  MissingEnvVarError,
} from "./env-substitution.js";

describe("resolveConfigEnvVars", () => {
  const env = {
    API_KEY: "sk-test-123",
    SECOND_KEY: "sk-fallback-456",
    BOT_TOKEN: "telegram-token-789",
  } as NodeJS.ProcessEnv;

  it("substitutes ${VAR} in strings", () => {
    const input = { key: "${API_KEY}" };
    const result = resolveConfigEnvVars(input, env) as Record<string, string>;
    expect(result.key).toBe("sk-test-123");
  });

  it("substitutes multiple vars in one string", () => {
    const input = { key: "a=${API_KEY}&b=${BOT_TOKEN}" };
    const result = resolveConfigEnvVars(input, env) as Record<string, string>;
    expect(result.key).toBe("a=sk-test-123&b=telegram-token-789");
  });

  it("handles nested objects", () => {
    const input = {
      provider: {
        authProfiles: [{ id: "main", apiKey: "${API_KEY}" }],
      },
    };
    const result = resolveConfigEnvVars(input, env) as any;
    expect(result.provider.authProfiles[0].apiKey).toBe("sk-test-123");
  });

  it("handles arrays", () => {
    const input = { keys: ["${API_KEY}", "${SECOND_KEY}"] };
    const result = resolveConfigEnvVars(input, env) as any;
    expect(result.keys).toEqual(["sk-test-123", "sk-fallback-456"]);
  });

  it("passes through non-string primitives", () => {
    const input = { port: 8080, enabled: true, empty: null };
    const result = resolveConfigEnvVars(input, env);
    expect(result).toEqual(input);
  });

  it("passes through strings without $ unchanged", () => {
    const input = { name: "anthropic" };
    const result = resolveConfigEnvVars(input, env) as Record<string, string>;
    expect(result.name).toBe("anthropic");
  });

  it("escapes $${VAR} to literal ${VAR}", () => {
    const input = { key: "$${API_KEY}" };
    const result = resolveConfigEnvVars(input, env) as Record<string, string>;
    expect(result.key).toBe("${API_KEY}");
  });

  it("throws MissingEnvVarError for missing vars", () => {
    const input = { key: "${NONEXISTENT_VAR}" };
    expect(() => resolveConfigEnvVars(input, env)).toThrow(MissingEnvVarError);
  });

  it("throws MissingEnvVarError for empty vars", () => {
    const envWithEmpty = { ...env, EMPTY_VAR: "" } as NodeJS.ProcessEnv;
    const input = { key: "${EMPTY_VAR}" };
    expect(() => resolveConfigEnvVars(input, envWithEmpty)).toThrow(MissingEnvVarError);
  });

  it("includes config path in MissingEnvVarError", () => {
    const input = { provider: { auth: "${MISSING_KEY}" } };
    try {
      resolveConfigEnvVars(input, env);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(MissingEnvVarError);
      expect((err as MissingEnvVarError).configPath).toBe("provider.auth");
      expect((err as MissingEnvVarError).varName).toBe("MISSING_KEY");
    }
  });

  it("ignores lowercase ${var} patterns (not valid env var names)", () => {
    const input = { x: "${lowercase}" };
    // lowercase doesn't match [A-Z_][A-Z0-9_]*, so passed through unchanged
    const result = resolveConfigEnvVars(input, env) as Record<string, string>;
    expect(result.x).toBe("${lowercase}");
  });

  it("handles $ not followed by { as literal", () => {
    const input = { price: "$100" };
    const result = resolveConfigEnvVars(input, env) as Record<string, string>;
    expect(result.price).toBe("$100");
  });
});

describe("containsEnvVarReference", () => {
  it("returns true for ${VAR}", () => {
    expect(containsEnvVarReference("${API_KEY}")).toBe(true);
  });

  it("returns false for escaped $${VAR}", () => {
    expect(containsEnvVarReference("$${API_KEY}")).toBe(false);
  });

  it("returns false for plain strings", () => {
    expect(containsEnvVarReference("hello world")).toBe(false);
  });

  it("returns false for lowercase ${var}", () => {
    expect(containsEnvVarReference("${lowercase}")).toBe(false);
  });

  it("returns true when mixed with escaped", () => {
    expect(containsEnvVarReference("$${ESCAPED} and ${REAL_ONE}")).toBe(true);
  });

  it("returns false for $ not followed by {", () => {
    expect(containsEnvVarReference("$100")).toBe(false);
  });
});
