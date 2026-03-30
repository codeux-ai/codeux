import { describe, expect, it } from "vitest";
import { slugify } from "../../../src/shared/slug.js";

describe("slugify", () => {
  it("slugifies standard text", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("handles empty strings", () => {
    expect(slugify("")).toBe("item");
    expect(slugify("---")).toBe("item");
  });

  it("slugifies text with multiple spaces and special characters", () => {
    expect(slugify("Hello   World!!!")).toBe("hello-world");
    expect(slugify("Some_Weird@String#here")).toBe("some-weird-string-here");
  });

  it("slugifies text starting and ending with hyphens to trim them", () => {
    expect(slugify("-hello-world-")).toBe("hello-world");
    expect(slugify("--hello--world--")).toBe("hello-world");
  });

  it("handles numbers", () => {
    expect(slugify("Feature 123")).toBe("feature-123");
  });
});
