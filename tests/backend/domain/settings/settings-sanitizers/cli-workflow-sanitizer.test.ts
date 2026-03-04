import { describe, expect, it } from "vitest";
import { sanitizeCliWorkflow } from "../../../../../src/domain/settings/settings-sanitizers/cli-workflow-sanitizer.js";

describe("sanitizeCliWorkflow", () => {
  it("applies fallback execution mode", () => {
    const result = sanitizeCliWorkflow({ cliWorkflow: { executionMode: "INVALID_MODE" as any } });
    expect(result.executionMode).toBe("HOST"); // Default mode
  });
});
