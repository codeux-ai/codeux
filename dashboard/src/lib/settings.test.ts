import { describe, expect, it } from "vitest";
import { cloneDefaultSettings } from "./settings.js";

describe("dashboard settings helpers", () => {
  it("returns fresh default objects", () => {
    const first = cloneDefaultSettings();
    const second = cloneDefaultSettings();
    first.git.defaultBranch = "develop";
    expect(second.git.defaultBranch).toBe("main");
  });
});
