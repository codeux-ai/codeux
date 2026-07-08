import { describe, expect, it } from "vitest";
import {
  parseDashboardFeatureFlagValue,
  resolveDashboardFeatureFlags,
} from "../../../dashboard/src/v2/lib/dashboard-feature-flags.js";
import { getPrimaryNavigationItems } from "../../../dashboard/src/v2/lib/navigation-items.js";
import { canPrefetchRoute } from "../../../dashboard/src/v2/router/route-prefetch.js";

const buildFeatureFlags = (overrides: Partial<Record<"nodes" | "custom-dashboards", boolean>> = {}) => ({
  nodes: true,
  "custom-dashboards": true,
  ...overrides,
});

const navigationLabels = (featureFlags: Record<"nodes" | "custom-dashboards", boolean>): string[] => (
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
    expect(resolveDashboardFeatureFlags({ devMode: true })).toEqual({ nodes: true, "custom-dashboards": true });
  });

  it("hides unfinished features by default outside development mode", () => {
    expect(resolveDashboardFeatureFlags({ devMode: false })).toEqual({ nodes: false, "custom-dashboards": false });
  });

  it("lets explicit values override the mode default", () => {
    expect(resolveDashboardFeatureFlags({ devMode: true, values: { nodes: "false", "custom-dashboards": "off" } })).toEqual({ nodes: false, "custom-dashboards": false });
    expect(resolveDashboardFeatureFlags({ devMode: false, values: { nodes: "true", "custom-dashboards": "enabled" } })).toEqual({ nodes: true, "custom-dashboards": true });
  });

  it("filters Nodes from shared navigation and prefetch when disabled", () => {
    expect(navigationLabels(buildFeatureFlags({ nodes: false }))).not.toContain("Nodes");
    expect(canPrefetchRoute("/nodes", buildFeatureFlags({ nodes: false }))).toBe(false);
  });

  it("keeps Nodes in shared navigation and prefetch when enabled", () => {
    expect(navigationLabels(buildFeatureFlags({ nodes: true }))).toContain("Nodes");
    expect(canPrefetchRoute("/nodes", buildFeatureFlags({ nodes: true }))).toBe(true);
  });

  it("filters custom dashboards from shared navigation and prefetch when disabled", () => {
    expect(navigationLabels(buildFeatureFlags({ "custom-dashboards": false }))).not.toContain("Dashboards");
    expect(canPrefetchRoute("/custom-dashboards", buildFeatureFlags({ "custom-dashboards": false }))).toBe(false);
  });

  it("keeps custom dashboards in shared navigation and prefetch when enabled", () => {
    expect(navigationLabels(buildFeatureFlags({ "custom-dashboards": true }))).toContain("Dashboards");
    expect(canPrefetchRoute("/custom-dashboards", buildFeatureFlags({ "custom-dashboards": true }))).toBe(true);
  });
});
