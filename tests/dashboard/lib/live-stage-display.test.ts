import { describe, expect, it } from "vitest";
import { getLiveActionDisplayProps } from "../../../dashboard/src/v2/lib/live-session-runtime.js";
import {
  STAGE_LABELS,
  STAGE_SHORT_LABELS,
  getLiveStageLabel,
  getLiveStageShortLabel,
  STATS_DECK_VISIBLE_STAGES,
} from "../../../dashboard/src/v2/lib/live-stage-display.js";

describe("live stage display", () => {
  it("maps ci stage to CI / Review label", () => {
    expect(getLiveStageLabel("ci")).toBe("CI / Review");
  });

  it("maps coding stage to Coding label", () => {
    expect(getLiveStageLabel("coding")).toBe("Coding");
  });

  it("maps autofix stage to Autofix label", () => {
    expect(getLiveStageLabel("autofix")).toBe("Autofix");
  });

  it("maps merge stage to Merge label", () => {
    expect(getLiveStageLabel("merge")).toBe("Merge");
  });

  it("maps qa stage to QA Gate label", () => {
    expect(getLiveStageLabel("qa")).toBe("QA Gate");
  });

  it("returns compact label for ci via short label helper", () => {
    expect(getLiveStageShortLabel("ci")).toBe("CI");
  });

  it("stats deck visible stages exclude queued", () => {
    expect(STATS_DECK_VISIBLE_STAGES).not.toContain("queued");
  });

  it("stats deck visible stages are exactly Coding, CI / Review, QA, Autofix, Merge in order", () => {
    expect(STATS_DECK_VISIBLE_STAGES).toEqual(["coding", "ci", "qa", "autofix", "merge"]);
  });

  it("all stats deck visible stages have full labels defined", () => {
    for (const stage of STATS_DECK_VISIBLE_STAGES) {
      expect(STAGE_LABELS[stage]).toBeDefined();
      expect(STAGE_LABELS[stage].length).toBeGreaterThan(0);
    }
  });

  it("all stats deck visible stages have short labels defined", () => {
    for (const stage of STATS_DECK_VISIBLE_STAGES) {
      expect(STAGE_SHORT_LABELS[stage]).toBeDefined();
      expect(STAGE_SHORT_LABELS[stage].length).toBeGreaterThan(0);
    }
  });

  it("handles getLiveActionDisplayProps for disabled and pending states correctly", () => {
    const disabledProps = getLiveActionDisplayProps(false, true);
    expect(disabledProps["aria-disabled"]).toBe(true);
    expect(disabledProps["aria-busy"]).toBe(false);

    const pendingProps = getLiveActionDisplayProps(true, false);
    expect(pendingProps["aria-disabled"]).toBe(true);
    expect(pendingProps["aria-busy"]).toBe(true);
  });
});
