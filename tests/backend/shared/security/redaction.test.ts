import { describe, expect, it } from "vitest";
import { isSensitiveKey, redactMetadata, redactText } from "../../../../src/shared/security/redaction.js";

describe("redaction", () => {
  describe("isSensitiveKey", () => {
    it("returns true for known sensitive keys regardless of case", () => {
      expect(isSensitiveKey("apiKey")).toBe(true);
      expect(isSensitiveKey("APIKEY")).toBe(true);
      expect(isSensitiveKey("authorization")).toBe(true);
      expect(isSensitiveKey("githubToken")).toBe(true);
      expect(isSensitiveKey("openaiCompatibleApiKey")).toBe(true);
      expect(isSensitiveKey("jiraApiToken")).toBe(true);
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

    it("redacts realistic provider and tracker token shapes", () => {
      const input = [
        "github ghp_123456789012345678901234567890123456",
        "fine-grained github_pat_1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_1234567890",
        "gitlab glpat-12345678901234567890",
        "jira ATATT3xFfGF0fixtureTokenValue1234567890",
        "openai-compatible sk-fixtureOpenAiCompatibleToken1234567890",
        "openrouter sk-or-v1-fixtureOpenRouterToken1234567890",
        "session codex-session-token=fixtureSessionToken1234567890",
        "bearer Authorization: Bearer fixture-bearer-token-value",
      ].join("\n");

      const result = redactText(input);

      expect(result).toBe([
        "github [REDACTED]",
        "fine-grained [REDACTED]",
        "gitlab [REDACTED]",
        "jira [REDACTED]",
        "openai-compatible [REDACTED]",
        "openrouter [REDACTED]",
        "session codex-session-token=[REDACTED]",
        "bearer Authorization: Bearer [REDACTED]",
      ].join("\n"));
    });

    it("redacts MCP and OTEL authorization headers in JSON, TOML, and env header syntax", () => {
      const token = "fixtureMcpBearerToken1234567890";
      const input = [
        `{"headers":{"Authorization":"Bearer ${token}"},"url":"https://example.invalid/mcp"}`,
        `http_headers = { "Authorization" = "Bearer ${token}", "X-Code-Ux-Agent" = "agent-1" }`,
        `OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer ${token},X-Team=platform`,
      ].join("\n");

      const result = redactText(input);

      expect(result).not.toContain(token);
      expect(result).toContain('"Authorization": "[REDACTED]"');
      expect(result).toContain('"Authorization" = "[REDACTED]"');
      expect(result).toContain("OTEL_EXPORTER_OTLP_HEADERS=[REDACTED]");
      expect(result).toContain('"X-Code-Ux-Agent" = "agent-1"');
      expect(result).toContain('"url":"https://example.invalid/mcp"');
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

    it("redacts provider, issue tracker, URL credential, and nested array secrets without leaking originals", () => {
      const secrets = {
        providerKey: "sk-providerFixtureKey123456789012",
        openaiCompatible: "sk-openaiCompatibleFixtureKey123456789",
        githubToken: "ghp_123456789012345678901234567890123456",
        gitlabToken: "glpat-12345678901234567890",
        jiraToken: "ATATT3xFfGF0fixtureJiraToken1234567890",
        bearerToken: "fixture-bearer-token",
        urlPassword: "fixture-password",
      };
      const nestedError = new Error(`Provider failed with Authorization: Bearer ${secrets.bearerToken}`);
      nestedError.stack = `Error: token ${secrets.openaiCompatible}\n    at provider`;

      const result = redactMetadata({
        providers: {
          codex: { apiKey: secrets.providerKey },
          openaiCompatible: { openaiCompatibleApiKey: secrets.openaiCompatible },
        },
        integrations: [
          { githubToken: secrets.githubToken },
          { gitlabToken: secrets.gitlabToken },
          { jiraApiToken: secrets.jiraToken },
          `remote=https://user:${secrets.urlPassword}@example.invalid/repo.git`,
        ],
        failure: {
          cause: nestedError,
          attempts: [
            { authorization: `Bearer ${secrets.bearerToken}` },
            [`Authorization: Bearer ${secrets.openaiCompatible}`],
          ],
        },
      }) as any;
      const serialized = JSON.stringify(result);

      for (const secret of Object.values(secrets)) {
        expect(serialized).not.toContain(secret);
      }
      expect(result.providers.codex.apiKey).toBe("[REDACTED]");
      expect(result.providers.openaiCompatible.openaiCompatibleApiKey).toBe("[REDACTED]");
      expect(result.integrations[3]).toBe("remote=https://[REDACTED]@example.invalid/repo.git");
      expect(result.failure.cause.message).toBe("Provider failed with Authorization: Bearer [REDACTED]");
      expect(result.failure.cause.stack).toBe("Error: token [REDACTED]\n    at provider");
      expect(result.failure.attempts[0].authorization).toBe("[REDACTED]");
      expect(result.failure.attempts[1][0]).toBe("Authorization: Bearer [REDACTED]");
    });
  });
});
