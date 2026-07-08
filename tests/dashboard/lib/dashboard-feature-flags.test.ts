import { describe, expect, it } from "vitest";
import {
  parseDashboardFeatureFlagValue,
  resolveDashboardFeatureFlags,
} from "../../../dashboard/src/v2/lib/dashboard-feature-flags.js";
import { getPrimaryNavigationItems } from "../../../dashboard/src/v2/lib/navigation-items.js";
import { canPrefetchRoute } from "../../../dashboard/src/v2/router/route-prefetch.js";

const navigationLabels = (featureFlags: { nodes: boolean }): string[] => (
  getPrimaryNavigationItems("EXPERT", { featureFlags }).map((item) => item.label)
);

describe("dashboard feature flags", () => {
  it("parses explicit enabled and disabled values", () => {
    expect(parseDashboardFeatureFlagValue("true")).toBe(true);
    expect(parseDashboardFeatureFlagValue("1")).toBe(true);
    expect(parseDashboardFeatureFlagValue("enabled")).toBe(true);
    expect(parseDashboardFeatureFlagValue("false")).toBe(false);
    expect(parseDashboardFeatureFlagValue("0")).toBe(false);
    expect(parseDashboardFeatureFlagValue("off")).toBe(false);
    expect(parseDashboardFeatureFlagValue("")).toBeNull();
    expect(parseDashboardFeatureFlagValue("maybe")).toBeNull();
  });

  it("shows unfinished features by default in development mode", () => {
    expect(resolveDashboardFeatureFlags({ devMode: true })).toEqual({ nodes: true });
  });

  it("hides unfinished features by default outside development mode", () => {
    expect(resolveDashboardFeatureFlags({ devMode: false })).toEqual({ nodes: false });
  });

  it("lets explicit values override the mode default", () => {
    expect(resolveDashboardFeatureFlags({ devMode: true, values: { nodes: "false" } })).toEqual({ nodes: false });
    expect(resolveDashboardFeatureFlags({ devMode: false, values: { nodes: "true" } })).toEqual({ nodes: true });
  });

  it("filters Nodes from shared navigation and prefetch when disabled", () => {
    expect(navigationLabels({ nodes: false })).not.toContain("Nodes");
    expect(canPrefetchRoute("/nodes", { nodes: false })).toBe(false);
  });

  it("keeps Nodes in shared navigation and prefetch when enabled", () => {
    expect(navigationLabels({ nodes: true })).toContain("Nodes");
    expect(canPrefetchRoute("/nodes", { nodes: true })).toBe(true);
  });
});
