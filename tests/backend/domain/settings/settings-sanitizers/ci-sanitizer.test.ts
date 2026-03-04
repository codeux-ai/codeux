import { describe, expect, it } from "vitest";
import { sanitizeCiIntelligence } from "../../../../../src/domain/settings/settings-sanitizers/ci-sanitizer.js";

describe("sanitizeCiIntelligence", () => {
  it("disables live pr monitoring when github mode is LOCAL", () => {
    const result = sanitizeCiIntelligence({ ciIntelligence: { enableLivePrMonitoring: true } }, "LOCAL");
    expect(result.enableLivePrMonitoring).toBe(false);
  });

  it("keeps live pr monitoring when github mode is REMOTE", () => {
    const result = sanitizeCiIntelligence({ ciIntelligence: { enableLivePrMonitoring: true } }, "REMOTE");
    expect(result.enableLivePrMonitoring).toBe(true);
  });

  it("maps autoMergeFeaturePrWhenGreen to featurePrAutoMergeMode", () => {
    const input = { ciIntelligence: { autoMergeFeaturePrWhenGreen: true } } as any;
    const result = sanitizeCiIntelligence(input, "REMOTE");
    expect(result.featurePrAutoMergeMode).toBe("WHEN_GREEN");
  });
});
