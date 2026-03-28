import { describe, expect, it } from "vitest";
import { slugify } from "../../../src/shared/slug.js";

describe("slugify", () => {
  it("lowercases and replaces spaces with dashes", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("removes non-alphanumeric characters", () => {
    expect(slugify("Feat: My feature!!")).toBe("feat-my-feature");
  });

  it("trims whitespace", () => {
    expect(slugify("   test string   ")).toBe("test-string");
  });

  it("removes edge dashes", () => {
    expect(slugify("-starts-and-ends-")).toBe("starts-and-ends");
  });

  it("returns 'item' for empty string", () => {
    expect(slugify("")).toBe("item");
    expect(slugify("    ")).toBe("item");
    expect(slugify("!@#$%")).toBe("item");
  });
});
