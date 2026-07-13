import { describe, expect, it } from "vitest";
import { getQaReviewPresentation } from "../../../../dashboard/src/v2/lib/qa-review-presentation.js";

describe("getQaReviewPresentation", () => {
  it.each([
    ["CHANGES_REQUESTED", null],
    ["changes-requested", null],
    ["Changes Requested", null],
    ["requested_changes", null],
    ["completed", "CHANGES_REQUESTED"],
    ["reviewed", "requested-changes"],
    ["running", "Requested Changes"],
  ])("classifies requested changes from status %s and outcome %s", (status, outcome) => {
    expect(getQaReviewPresentation({ status, outcome })).toEqual({
      kind: "changes-requested",
      heading: "QA Changes Requested",
      badgeLabel: "QA Changes Requested",
      screenReaderLabel: "QA changes requested.",
    });
  });

  it.each(["running", "IN_PROGRESS", "in-progress", "Reviewing"])(
    "preserves the running presentation for %s",
    (status) => {
      expect(getQaReviewPresentation({ status, outcome: null }).kind).toBe("running");
    },
  );

  it("preserves the reviewed presentation for a successful review", () => {
    expect(getQaReviewPresentation({ status: "completed", outcome: "passed" })).toEqual({
      kind: "reviewed",
      heading: "QA Review Complete",
      badgeLabel: "QA Reviewed",
      screenReaderLabel: "QA review complete.",
    });
  });
});
