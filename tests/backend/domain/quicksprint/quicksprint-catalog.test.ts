import { describe, expect, it } from "vitest";
import { BUILTIN_QUICKSPRINT_TEMPLATES } from "../../../../src/domain/quicksprint/quicksprint-catalog.js";

describe("BUILTIN_QUICKSPRINT_TEMPLATES", () => {
  it("ships the fullstack js app default template set with the expected built-ins", () => {
    expect(BUILTIN_QUICKSPRINT_TEMPLATES.map((template) => template.id)).toEqual([
      "qs-code-quality",
      "qs-security",
      "qs-ui-a11y",
      "qs-ui-design",
      "qs-ui-responsive",
      "qs-ui-interactions",
    ]);

    for (const template of BUILTIN_QUICKSPRINT_TEMPLATES) {
      expect(template.isBuiltIn).toBe(true);
      expect(template.purpose).toBe("fullstack-js-app");
      expect(template.purposeLabel).toBe("Fullstack JS App");
      expect(template.purposeDescription).toContain("JavaScript and TypeScript");
      expect(template.defaultTaskCount).toBeGreaterThan(0);
    }
  });

  it("keeps built-in prompts project-agnostic and avoids overly prescriptive hardcoded UI values", () => {
    for (const template of BUILTIN_QUICKSPRINT_TEMPLATES) {
      expect(template.agentInstructionMarkdown).not.toMatch(/src\//);
      expect(template.agentInstructionMarkdown).not.toMatch(/dashboard\/src/);
      expect(template.agentInstructionMarkdown).not.toMatch(/\.tsx\b/);
      expect(template.agentInstructionMarkdown).not.toMatch(/\b44\s*x\s*44\b/i);
    }
  });
});
