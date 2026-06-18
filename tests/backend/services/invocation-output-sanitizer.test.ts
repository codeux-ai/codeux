import { describe, expect, it } from "vitest";
import { sanitizeInvocationOutputText } from "../../../src/services/invocation-output-sanitizer.js";

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
});
