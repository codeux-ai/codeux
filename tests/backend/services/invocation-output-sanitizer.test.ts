import { describe, expect, it } from "vitest";
import { sanitizeInvocationOutputText } from "../../../src/services/invocation-output-sanitizer.js";
import { redactMetadata } from "../../../src/shared/security/redaction.js";

describe("sanitizeInvocationOutputText", () => {
  it("removes the unborn bootstrap branch fatal line", () => {
    const input = "fatal: your current branch 'code-ux-bootstrap-1' does not have any commits yet";
    expect(sanitizeInvocationOutputText(input)).toBe("");
  });

  it("keeps the same fatal message for non-bootstrap branches", () => {
    const input = "fatal: your current branch 'feature/my-branch' does not have any commits yet";
    expect(sanitizeInvocationOutputText(input)).toBe(input);
  });

  it("removes only the bootstrap fatal line from mixed multiline output", () => {
    const input = [
      "line before",
      "fatal: your current branch 'code-ux-bootstrap-1' does not have any commits yet",
      "fatal: not a git repository",
      "line after",
    ].join("\n");

    expect(sanitizeInvocationOutputText(input)).toBe(["line before", "fatal: not a git repository", "line after"].join("\n"));
  });

  it("removes Qwen legacy OpenAI logging warnings", () => {
    const input = [
      "Hello",
      "Warning: Legacy setting 'enableOpenAILogging' will be ignored in /workspace/.code-ux-home/.qwen/settings.json. Please use 'model.enableOpenAILogging' instead.",
      "world",
    ].join("\n");

    expect(sanitizeInvocationOutputText(input)).toBe("Hello\nworld");
  });

  it("removes repeated inline Qwen legacy OpenAI logging warnings", () => {
    const warning = "Warning: Legacy setting 'enableOpenAILogging' will be ignored in /workspace/.code-ux-home/.qwen/settings.json. Please use 'model.enableOpenAILogging' instead.";
    const input = `The first message was hello. ${warning} ${warning} ${warning}`;

    expect(sanitizeInvocationOutputText(input)).toBe("The first message was hello.");
  });

  it("redacts sensitive keys in JSON structures", () => {
    const input = '{"apiKey": "secret123", "normal": "value"}';
    expect(sanitizeInvocationOutputText(input)).toBe('{"apiKey": "[REDACTED]", "normal": "value"}');
  });

  it("redacts environment variable assignments", () => {
    const input = 'export OPENAI_API_KEY=sk-12345\nOPENAI_API_KEY="sk-12345"';
    expect(sanitizeInvocationOutputText(input)).toBe('export OPENAI_API_KEY=[REDACTED]\nOPENAI_API_KEY="[REDACTED]"');
  });

  it("redacts Authorization Bearer tokens", () => {
    const input = 'Authorization: Bearer my-secret-token\n--header "Authorization: Bearer other-token"';
    expect(sanitizeInvocationOutputText(input)).toBe('Authorization: Bearer [REDACTED]\n--header "Authorization: Bearer [REDACTED]"');
  });

  it("redacts GitHub tokens", () => {
    const input = 'here is my token ghp_123456789012345678901234567890123456';
    expect(sanitizeInvocationOutputText(input)).toBe('here is my token [REDACTED]');
  });

  it("redacts GitLab tokens", () => {
    const input = 'gitlab token glpat-12345678901234567890';
    expect(sanitizeInvocationOutputText(input)).toBe('gitlab token [REDACTED]');
  });

  it("redacts URL credentials", () => {
    const input = 'connecting to https://user:pass@example.com/api';
    expect(sanitizeInvocationOutputText(input)).toBe('connecting to https://[REDACTED]@example.com/api');
  });

  it("redacts Basic auth", () => {
    const input = 'Authorization: Basic some-base64-string';
    expect(sanitizeInvocationOutputText(input)).toBe('Authorization: Basic [REDACTED]');
  });

  it("redacts provider and MCP secrets from dashboard-visible invocation output", () => {
    const secrets = [
      "fixture-gemini-api-key-secret",
      "fixture-codex-openai-api-key-secret",
      "fixture-claude-auth-token-secret",
      "fixture-qwen-api-key-secret",
      "fixture-opencode-api-key-secret",
      "fixture-antigravity-api-key-secret",
      "fixture-mcp-auth-token-secret",
    ];
    const input = [
      `GEMINI_API_KEY=${secrets[0]}`,
      `OPENAI_API_KEY="${secrets[1]}"`,
      `ANTHROPIC_AUTH_TOKEN=${secrets[2]}`,
      `QWEN_API_KEY=${secrets[3]}`,
      `OPENCODE_API_KEY=${secrets[4]}`,
      `ANTIGRAVITY_API_KEY=${secrets[5]}`,
      `Authorization: Bearer ${secrets[6]}`,
      "provider=qwen-code invocationId=invocation-123 sessionId=session-456",
    ].join("\n");

    const sanitized = sanitizeInvocationOutputText(input);
    for (const secret of secrets) {
      expect(sanitized).not.toContain(secret);
    }
    expect(sanitized).toContain("provider=qwen-code");
    expect(sanitized).toContain("invocationId=invocation-123");
    expect(sanitized).toContain("sessionId=session-456");
  });

  it("redacts provider and MCP secrets from structured logger metadata without removing operational ids", () => {
    const metadata = redactMetadata({
      provider: "codex",
      invocationId: "invocation-structured-1",
      sessionId: "session-structured-1",
      providerEnv: {
        GEMINI_API_KEY: "fixture-gemini-api-key-secret",
        OPENAI_API_KEY: "fixture-codex-openai-api-key-secret",
        ANTHROPIC_AUTH_TOKEN: "fixture-claude-auth-token-secret",
        QWEN_API_KEY: "fixture-qwen-api-key-secret",
        OPENCODE_API_KEY: "fixture-opencode-api-key-secret",
        ANTIGRAVITY_API_KEY: "fixture-antigravity-api-key-secret",
      },
      mcpConnection: {
        authToken: "fixture-mcp-auth-token-secret",
        headers: { Authorization: "Bearer fixture-mcp-header-token-secret" },
      },
      dockerArgs: [
        "--label",
        "code-ux.session-id=session-structured-1",
        "--env-file",
        "/tmp/code-ux-docker-123/provider.env",
      ],
    }) as any;

    const serialized = JSON.stringify(metadata);
    for (const secret of [
      "fixture-gemini-api-key-secret",
      "fixture-codex-openai-api-key-secret",
      "fixture-claude-auth-token-secret",
      "fixture-qwen-api-key-secret",
      "fixture-opencode-api-key-secret",
      "fixture-antigravity-api-key-secret",
      "fixture-mcp-auth-token-secret",
      "fixture-mcp-header-token-secret",
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(metadata.provider).toBe("codex");
    expect(metadata.invocationId).toBe("invocation-structured-1");
    expect(metadata.sessionId).toBe("session-structured-1");
    expect(metadata.dockerArgs).toContain("code-ux.session-id=session-structured-1");
  });
});
