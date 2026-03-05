import { describe, expect, it } from "vitest";
import { parseJson, parseOpenPrs, parseCiRuns, parseMergedPrs } from "../../../../src/infrastructure/git/git-status-mappers.js";

describe("git-status-mappers", () => {
  it("parseJson handles valid and invalid json", () => {
    expect(parseJson('{"a": 1}')).toEqual({ a: 1 });
    expect(parseJson('invalid')).toBeNull();
  });

  describe("parseOpenPrs", () => {
    it("handles invalid json", () => {
      expect(parseOpenPrs("invalid")).toEqual({ data: [], warning: "Could not parse pull request status response." });
    });

    it("parses valid prs", () => {
      const json = JSON.stringify([{
        number: 1,
        title: "PR 1",
        url: "http://url",
        state: "OPEN",
        isDraft: false,
        headRefName: "head",
        baseRefName: "base",
        mergeStateStatus: "CLEAN",
        reviewDecision: "APPROVED",
        updatedAt: "now",
        comments: 2,
        statusCheckRollup: [
          { name: "lint", status: "COMPLETED", conclusion: "SUCCESS" },
          "invalid string",
          null
        ]
      }, {
        comments: { totalCount: 3 },
        statusCheckRollup: [
            { context: "test", status: "COMPLETED", conclusion: "SUCCESS" }
        ]
      }]);
      const res = parseOpenPrs(json);
      expect(res.data).toHaveLength(2);
      expect(res.data[0].number).toBe(1);
      expect(res.data[0].comments).toBe(2);
      expect(res.data[0].checks).toHaveLength(1);
      expect(res.data[0].checks[0].name).toBe("lint");
      expect(res.data[1].comments).toBe(3);
      expect(res.data[1].checks[0].name).toBe("test");
    });
  });

  describe("parseCiRuns", () => {
    it("handles invalid json", () => {
      expect(parseCiRuns("invalid")).toEqual({ data: [], warning: "Could not parse CI run response." });
    });

    it("parses valid runs", () => {
      const json = JSON.stringify([{
        databaseId: 1,
        name: "run1",
        workflowName: "wf",
        status: "COMPLETED",
        conclusion: "SUCCESS",
        event: "push",
        headBranch: "main",
        url: "http://url",
        updatedAt: "now"
      }, {}]);
      const res = parseCiRuns(json);
      expect(res.data).toHaveLength(2);
      expect(res.data[0].id).toBe(1);
      expect(res.data[1].name).toBe("workflow");
    });
  });

  describe("parseMergedPrs", () => {
    it("handles invalid json", () => {
      expect(parseMergedPrs("invalid")).toEqual({ data: [], warning: "Could not parse merged PR response." });
    });

    it("parses valid merged prs", () => {
      const json = JSON.stringify([{
        number: 1,
        title: "PR 1",
        url: "http://url",
        headRefName: "head",
        baseRefName: "base",
        mergedAt: "now",
        mergedBy: { login: "user" }
      }, { mergedBy: "string" }]);
      const res = parseMergedPrs(json);
      expect(res.data).toHaveLength(2);
      expect(res.data[0].number).toBe(1);
      expect(res.data[0].mergedBy).toBe("user");
      expect(res.data[1].mergedBy).toBeNull();
    });
  });
});
