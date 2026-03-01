import { describe, expect, it } from "vitest";
import { renderTemplate } from "./instruction-template-renderer.js";

describe("renderTemplate", () => {
  it("replaces simple placeholders", () => {
    const rendered = renderTemplate("Hello {{name}}", { name: "Jules" });
    expect(rendered).toBe("Hello Jules");
  });

  it("supports nested placeholders", () => {
    const rendered = renderTemplate("Branch: {{git.branch}}", { git: { branch: "main" } });
    expect(rendered).toBe("Branch: main");
  });

  it("renders missing placeholders as empty strings", () => {
    const rendered = renderTemplate("X{{missing}}Y", {});
    expect(rendered).toBe("XY");
  });
});
