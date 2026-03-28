import { describe, expect, it, vi, beforeEach } from "vitest";
import * as fs from "fs/promises";
import { runPlanningPreflightStep } from "../../../../src/sprint/steps/planning-preflight-step.js";

vi.mock("fs/promises");

describe("runPlanningPreflightStep", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns false if directory access fails", async () => {
    vi.mocked(fs.access).mockRejectedValueOnce(new Error("enoent"));

    const result = await runPlanningPreflightStep("/dir");

    expect(result).toBe(false);
  });

  it("returns false if there are no markdown files", async () => {
    vi.mocked(fs.access).mockResolvedValueOnce(undefined);
    vi.mocked(fs.readdir).mockResolvedValueOnce(["test.txt", "file.json"] as any);

    const result = await runPlanningPreflightStep("/dir");

    expect(result).toBe(false);
  });

  it("returns true if there is at least one markdown file", async () => {
    vi.mocked(fs.access).mockResolvedValueOnce(undefined);
    vi.mocked(fs.readdir).mockResolvedValueOnce(["test.txt", "task.md"] as any);

    const result = await runPlanningPreflightStep("/dir");

    expect(result).toBe(true);
  });
});
