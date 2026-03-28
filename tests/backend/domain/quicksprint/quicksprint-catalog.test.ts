import { describe, expect, it } from "vitest";
import { BUILTIN_QUICKSPRINT_TEMPLATES } from "../../../../src/domain/quicksprint/quicksprint-catalog.js";

describe("quicksprint-catalog", () => {
  it("exports BUILTIN_QUICKSPRINT_TEMPLATES with correct items", () => {
    expect(BUILTIN_QUICKSPRINT_TEMPLATES).toBeInstanceOf(Array);
    expect(BUILTIN_QUICKSPRINT_TEMPLATES.length).toBe(3);

    expect(BUILTIN_QUICKSPRINT_TEMPLATES[0].id).toBe("qs-code-quality");
    expect(BUILTIN_QUICKSPRINT_TEMPLATES[1].id).toBe("qs-security");
    expect(BUILTIN_QUICKSPRINT_TEMPLATES[2].id).toBe("qs-ui-a11y");
  });

  it("ensures all builtin templates have isBuiltIn flag set to true", () => {
      BUILTIN_QUICKSPRINT_TEMPLATES.forEach(template => {
          expect(template.isBuiltIn).toBe(true);
          expect(template.projectId).toBeNull();
      });
  });
});
