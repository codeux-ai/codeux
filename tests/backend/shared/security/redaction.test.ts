import { describe, expect, it } from "vitest";
import { isSensitiveKey, redactMetadata, redactText } from "../../../../src/shared/security/redaction.js";

describe("redaction", () => {
  describe("isSensitiveKey", () => {
    it("returns true for known sensitive keys regardless of case", () => {
      expect(isSensitiveKey("apiKey")).toBe(true);
      expect(isSensitiveKey("APIKEY")).toBe(true);
      expect(isSensitiveKey("authorization")).toBe(true);
      expect(isSensitiveKey("githubToken")).toBe(true);
    });

    it("returns false for normal keys", () => {
      expect(isSensitiveKey("message")).toBe(false);
      expect(isSensitiveKey("id")).toBe(false);
    });
  });

  describe("redactText", () => {
    it("redacts sensitive keys in JSON structures", () => {
      const input = '{"apiKey": "secret123", "normal": "value"}';
      expect(redactText(input)).toBe('{"apiKey": "[REDACTED]", "normal": "value"}');
    });

    it("redacts environment variable assignments", () => {
      const input = 'export OPENAI_API_KEY=sk-12345\nOPENAI_API_KEY="sk-12345"';
      expect(redactText(input)).toBe('export OPENAI_API_KEY=[REDACTED]\nOPENAI_API_KEY="[REDACTED]"');
    });

    it("redacts Authorization Bearer tokens", () => {
      const input = 'Authorization: Bearer my-secret-token\n--header "Authorization: Bearer other-token"';
      expect(redactText(input)).toBe('Authorization: Bearer [REDACTED]\n--header "Authorization: Bearer [REDACTED]"');
    });

    it("redacts Authorization Basic tokens", () => {
      const input = 'Authorization: Basic user:pass\n--header "Authorization: Basic other-token"';
      expect(redactText(input)).toBe('Authorization: Basic [REDACTED]\n--header "Authorization: Basic [REDACTED]"');
    });

    it("redacts GitHub tokens", () => {
      const input = 'here is my token ghp_123456789012345678901234567890123456';
      expect(redactText(input)).toBe('here is my token [REDACTED]');
    });

    it("redacts GitLab tokens", () => {
      const input = 'gitlab token glpat-12345678901234567890';
      expect(redactText(input)).toBe('gitlab token [REDACTED]');
    });

    it("redacts URL credentials", () => {
      const input = 'connecting to https://user:pass@example.com/api/test';
      expect(redactText(input)).toBe('connecting to https://[REDACTED]@example.com/api/test');
    });

    it("handles falsy values", () => {
      expect(redactText("")).toBe("");
    });
  });

  describe("redactMetadata", () => {
    it("redacts values of sensitive keys", () => {
      const result = redactMetadata("my-secret", "apiKey");
      expect(result).toBe("[REDACTED]");
    });

    it("redacts tokens within non-sensitive string values", () => {
      const result = redactMetadata("Authorization: Bearer xyz", "message");
      expect(result).toBe("Authorization: Bearer [REDACTED]");
    });

    it("handles arrays", () => {
      const result = redactMetadata([
        "Authorization: Bearer xyz",
        { apiKey: "secret" },
        "normal"
      ], "items") as any[];
      expect(result).toHaveLength(3);
      expect(result[0]).toBe("Authorization: Bearer [REDACTED]");
      expect(result[1]).toEqual({ apiKey: "[REDACTED]" });
      expect(result[2]).toBe("normal");
    });

    it("handles nested objects without mutating original", () => {
      const original = {
        nested: {
          token: "secret123",
          message: "Authorization: Bearer token123",
          count: 5
        }
      };

      const result = redactMetadata(original) as any;

      expect(result).toEqual({
        nested: {
          token: "[REDACTED]",
          message: "Authorization: Bearer [REDACTED]",
          count: 5
        }
      });

      expect(original.nested.token).toBe("secret123");
    });

    it("redacts messages and stacks within Error objects", () => {
      const error = new Error("Failed due to Authorization: Bearer secret_token");
      error.stack = "Error: Failed due to Authorization: Bearer secret_token\n  at fn (test.js:1:1)";

      const result = redactMetadata(error) as any;

      expect(result.name).toBe("Error");
      expect(result.message).toBe("Failed due to Authorization: Bearer [REDACTED]");
      expect(result.stack).toBe("Error: Failed due to Authorization: Bearer [REDACTED]\n  at fn (test.js:1:1)");
    });

    it("converts bigint to string", () => {
      expect(redactMetadata(BigInt(9007199254740991))).toBe("9007199254740991");
    });

    it("redacts secret-looking values from structured log metadata", () => {
      const rawApiKey = "sk-test-value-12345";
      const rawGithubToken = "ghp_123456789012345678901234567890123456";
      const rawUrlPassword = "fixture-pass";
      const result = redactMetadata({
        request: {
          headers: {
            authorization: `Bearer ${rawApiKey}`,
          },
          url: `https://user:${rawUrlPassword}@example.invalid/repo.git`,
        },
        provider: {
          githubToken: rawGithubToken,
        },
        message: `Authorization: Bearer ${rawApiKey}`,
      }) as any;
      const serialized = JSON.stringify(result);

      expect(serialized).not.toContain(rawApiKey);
      expect(serialized).not.toContain(rawGithubToken);
      expect(serialized).not.toContain(rawUrlPassword);
      expect(result.request.headers.authorization).toBe("[REDACTED]");
      expect(result.provider.githubToken).toBe("[REDACTED]");
      expect(result.message).toBe("Authorization: Bearer [REDACTED]");
    });
  });
});
