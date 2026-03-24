import re

with open("tests/dashboard/lib/sprint-composer-state.test.ts", "r") as f:
    content = f.read()

# Replace imports
content = content.replace("getAvailableModes, toPlanningOverrides", "getAvailableModes, toPlanningOverrides, resolveSubmitOriginalPrompt")

# Add tests for resolveSubmitOriginalPrompt
tests = """

  describe("resolveSubmitOriginalPrompt", () => {
    it("returns goal when mode is plan_only and originalPrompt is null", () => {
      expect(resolveSubmitOriginalPrompt("plan_only", null, "New goal text")).toBe("New goal text");
    });

    it("returns goal when mode is plan_and_start and originalPrompt is empty", () => {
      expect(resolveSubmitOriginalPrompt("plan_and_start", "", "New goal text")).toBe("New goal text");
    });

    it("returns existing originalPrompt when mode is plan_only", () => {
      expect(resolveSubmitOriginalPrompt("plan_only", "Existing original", "New goal text")).toBe("Existing original");
    });

    it("returns existing originalPrompt when mode is draft", () => {
      expect(resolveSubmitOriginalPrompt("draft", "Existing original", "New goal text")).toBe("Existing original");
    });

    it("returns null when mode is draft and originalPrompt is null", () => {
      expect(resolveSubmitOriginalPrompt("draft", null, "New goal text")).toBeNull();
    });

    it("returns null when mode is replan and originalPrompt is null", () => {
      expect(resolveSubmitOriginalPrompt("replan", null, "New goal text")).toBeNull();
    });

    it("trims returned goal", () => {
      expect(resolveSubmitOriginalPrompt("plan_and_start", null, "  Spaced goal  ")).toBe("Spaced goal");
    });
  });"""

content = content.replace("  });\n});", "  });" + tests + "\n});")

with open("tests/dashboard/lib/sprint-composer-state.test.ts", "w") as f:
    f.write(content)
