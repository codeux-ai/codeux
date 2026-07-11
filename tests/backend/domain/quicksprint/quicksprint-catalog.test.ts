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
      "qs-create-web-app",
      "qs-create-desktop-app",
      "qs-create-online-shop",
      "qs-create-portfolio",
      "qs-create-game",
    ]);

    for (const template of BUILTIN_QUICKSPRINT_TEMPLATES.slice(0, 6)) {
      expect(template.isBuiltIn).toBe(true);
      expect(template.purpose).toBe("fullstack-js-app");
      expect(template.purposeLabel).toBe("Fullstack JS App");
      expect(template.purposeDescription).toContain("JavaScript and TypeScript");
      expect(template.defaultTaskCount).toBeGreaterThan(0);
    }
  });

  it("loads all create-app templates through the built-in Markdown catalog parser", () => {
    const createAppTemplates = BUILTIN_QUICKSPRINT_TEMPLATES.filter((template) => template.purpose === "create-app");

    expect(createAppTemplates.map((template) => template.id)).toEqual([
      "qs-create-web-app",
      "qs-create-desktop-app",
      "qs-create-online-shop",
      "qs-create-portfolio",
      "qs-create-game",
    ]);
    for (const template of createAppTemplates) {
      expect(template.isBuiltIn).toBe(true);
      expect(template.purposeLabel).toBe("Create App");
      expect(template.agentInstructionMarkdown).toMatch(/inspect the repository/i);
      expect(template.agentInstructionMarkdown).toMatch(/catalog-selected/i);
      expect(template.agentInstructionMarkdown).toMatch(/implementation-ready product DAG/i);
      expect(template.agentInstructionMarkdown).toMatch(/Do not ask for confirmation|Do not seek confirmation/i);
      expect(template.agentInstructionMarkdown).toMatch(/Do not assume|Do not invent/i);
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
