import { describe, it, expect } from "vitest";
import { LateBoundLink } from "../../../../../src/app/dependency-factory/helpers/late-bound-link.js";

describe("LateBoundLink", () => {
  it("should throw if not bound", () => {
    const link = new LateBoundLink<string>("testLink");
    expect(() => link.get()).toThrowError("LateBoundLink 'testLink' has not been bound yet.");
  });

  it("should return the bound instance", () => {
    const link = new LateBoundLink<string>("testLink");
    link.bind("boundValue");
    expect(link.get()).toBe("boundValue");
  });

  it("should throw if bound multiple times", () => {
    const link = new LateBoundLink<string>("testLink");
    link.bind("boundValue");
    expect(() => link.bind("anotherValue")).toThrowError("LateBoundLink 'testLink' has already been bound.");
  });
});
