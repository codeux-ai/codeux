import { describe, expect, it } from "vitest";
import { GuideRepository } from "../../../src/repositories/guide-repository.js";

describe("GuideRepository", () => {
    it("handles load failure by throwing custom error", async () => {
        const repo = new GuideRepository("/tmp");
        await expect(repo.getGuideContent("missing.md")).rejects.toThrow("Guide not found: missing.md");
    });
});
