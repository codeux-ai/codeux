/** @vitest-environment happy-dom */
import { h } from "preact";
import { cleanup, render, screen } from "@testing-library/preact";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getVisibleSettingsCategories } from "../../../dashboard/src/v2/SettingsPage.js";
import { CATEGORIES } from "../../../dashboard/src/v2/components/settings/SettingsCategoryRail.js";
import { SettingsModelsPanel } from "../../../dashboard/src/v2/components/settings/panels/SettingsModelsPanel.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-defaults.js";

const createModelsPanelState = (easyExperienceMode: boolean): any => ({
  activeScope: "system",
  editableSettings: structuredClone(DEFAULT_DASHBOARD_SETTINGS),
  projectSources: {},
  systemSettings: {
    defaults: structuredClone(DEFAULT_DASHBOARD_SETTINGS),
    integrations: { providers: {} },
  },
  externalHints: null,
  activeInvocationRoute: "task_coding",
  setActiveInvocationRoute: vi.fn(),
  invocationRouteDefinitions: [
    { id: "task_coding", label: "Task coding", description: "Primary coding execution." },
  ],
  routingProfileOptions: [
    { value: "GLOBAL", label: "Global defaults" },
    { value: "WORKER", label: "Worker defaults" },
  ],
  updateEditableSettings: vi.fn(),
  easyExperienceMode,
});

afterEach(cleanup);

describe("settings Easy mode", () => {
  it("keeps only the essential category ids in Easy mode and all ids in Expert mode", () => {
    expect(getVisibleSettingsCategories(true).map((category) => category.id)).toEqual([
      "appearance",
      "guidance",
      "models",
    ]);
    expect(getVisibleSettingsCategories(false).map((category) => category.id)).toEqual(
      CATEGORIES.map((category) => category.id),
    );
  });

  it("hides advanced AI model sections in Easy mode while retaining routing anchors and mapping", () => {
    const { rerender } = render(<SettingsModelsPanel state={createModelsPanelState(true)} />);

    expect(screen.getByText("Default Routing Anchors")).toBeInTheDocument();
    expect(screen.getByText("Route Mapping")).toBeInTheDocument();
    expect(screen.queryByText("Base Provider Configuration")).not.toBeInTheDocument();
    expect(screen.queryByText("Provider defaults, route decisions, and runtime capacity in one place.")).not.toBeInTheDocument();
    expect(screen.queryByText("Model Pricing")).not.toBeInTheDocument();
    expect(screen.queryByText("Allowed pool")).not.toBeInTheDocument();
    expect(screen.queryByText("Max concurrency")).not.toBeInTheDocument();

    rerender(<SettingsModelsPanel state={createModelsPanelState(false)} />);

    expect(screen.getByText("Base Provider Configuration")).toBeInTheDocument();
    expect(screen.getByText("Provider defaults, route decisions, and runtime capacity in one place.")).toBeInTheDocument();
    expect(screen.getByText("Allowed pool")).toBeInTheDocument();
  });
});
