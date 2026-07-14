import { describe, expect, it } from "vitest";
import {
  buildCinematicQuickActions,
  isInitialProjectCreateAppQuickaction,
} from "../cinematic-quick-actions.js";
import type { DashboardFeatureFlagMap } from "../dashboard-feature-flags.js";

const ALL_LABELS = [
  "Create Web App",
  "Create Desktop App",
  "Create Onlineshop",
  "Create Portfolio",
  "Create Game",
  "Status Report",
  "Sprint Progress",
  "What’s Failing?",
  "Plan Next Steps",
  "Create Skill",
  "List Skills",
];

const buildFeatureFlags = (overrides: Partial<DashboardFeatureFlagMap> = {}): DashboardFeatureFlagMap => ({
  nodes: true,
  "custom-dashboards": true,
  "chat-nodes-workflow-quick-action": false,
  "chat-custom-dashboard-quick-action": false,
  ...overrides,
});

describe("cinematic quick action view model", () => {
  it("builds the complete catalog-driven action set for an eligible project", () => {
    const actions = buildCinematicQuickActions({
      hasProject: true,
      initialEligibilityLoaded: true,
      canCreateInitialAppQuickactions: true,
    });

    expect(actions.map(({ label }) => label)).toEqual(ALL_LABELS);
    expect(actions.filter(({ actionType }) => actionType === "create_app")).toMatchObject([
      { appKind: "web_app" },
      { appKind: "desktop_app" },
      { appKind: "online_shop" },
      { appKind: "portfolio" },
      { appKind: "game" },
    ]);
    expect(actions.filter(({ actionType }) => actionType === "send_prompt")).toHaveLength(6);
    expect(new Set(actions.map(({ id }) => id))).toHaveLength(actions.length);
    expect(new Set(actions.map(({ zone }) => zone))).toEqual(new Set(["create", "insight", "workflow"]));
  });

  it("fails closed for every create-app action while keeping project prompt actions", () => {
    for (const options of [
      { initialEligibilityLoaded: false, canCreateInitialAppQuickactions: true },
      { initialEligibilityLoaded: true, canCreateInitialAppQuickactions: false },
    ]) {
      const actions = buildCinematicQuickActions({ hasProject: true, ...options });
      expect(actions.map(({ label }) => label)).toEqual(ALL_LABELS.slice(5));
    }

    expect(isInitialProjectCreateAppQuickaction("web_app")).toBe(true);
    expect(isInitialProjectCreateAppQuickaction("desktop_app")).toBe(true);
    expect(isInitialProjectCreateAppQuickaction("online_shop")).toBe(true);
    expect(isInitialProjectCreateAppQuickaction("portfolio")).toBe(true);
    expect(isInitialProjectCreateAppQuickaction("game")).toBe(true);
  });

  it("does not expose generic quick actions without a selected project", () => {
    expect(buildCinematicQuickActions({
      hasProject: false,
      initialEligibilityLoaded: true,
      canCreateInitialAppQuickactions: true,
    })).toEqual([]);
  });

  it("shows gated workflow actions only when both action and surface flags are enabled", () => {
    const build = (featureFlags: DashboardFeatureFlagMap) => buildCinematicQuickActions({
      hasProject: true,
      initialEligibilityLoaded: false,
      canCreateInitialAppQuickactions: false,
      featureFlags,
    }).map(({ label }) => label);

    expect(build(buildFeatureFlags())).not.toEqual(expect.arrayContaining([
      "Add Nodes Workflow",
      "Add Dashboard",
    ]));
    expect(build(buildFeatureFlags({
      "chat-nodes-workflow-quick-action": true,
      "chat-custom-dashboard-quick-action": true,
    }))).toEqual(expect.arrayContaining([
      "Add Nodes Workflow",
      "Add Dashboard",
    ]));
    expect(build(buildFeatureFlags({
      nodes: false,
      "custom-dashboards": false,
      "chat-nodes-workflow-quick-action": true,
      "chat-custom-dashboard-quick-action": true,
    }))).not.toEqual(expect.arrayContaining([
      "Add Nodes Workflow",
      "Add Dashboard",
    ]));
  });
});
