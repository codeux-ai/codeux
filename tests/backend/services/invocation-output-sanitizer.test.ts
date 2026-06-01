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
});

