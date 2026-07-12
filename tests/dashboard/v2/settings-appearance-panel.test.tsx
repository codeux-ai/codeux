/** @vitest-environment happy-dom */
/** @jsx h */
import { h } from "preact";
import { useState } from "preact/hooks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { SettingsAppearancePanel } from "../../../dashboard/src/v2/components/settings/panels/SettingsAppearancePanel.js";
import { cloneProjectSettings } from "../../../dashboard/src/v2/lib/settings/project-overrides.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-defaults.js";

expect.extend(matchers);

vi.mock("../../../dashboard/src/v2/hooks/useThemeSetting.js", () => ({
  useThemeSetting: () => ({ theme: "SYSTEM", setTheme: vi.fn() }),
}));

const Harness = () => {
  const [settings, setSettings] = useState(cloneProjectSettings(DEFAULT_DASHBOARD_SETTINGS));
  return (
    <SettingsAppearancePanel state={{
      activeScope: "system",
      systemSettings: null,
      projectSettings: null,
      selectedProject: null,
      editableSettings: settings,
      updateEditableSettings: (recipe) => setSettings((current) => recipe(current)),
      updateSystem: vi.fn(),
      projectSources: {},
    } as any} />
  );
};

describe("SettingsAppearancePanel accent colors", () => {
  beforeEach(() => {
    delete document.documentElement.dataset.accent;
  });

  afterEach(() => {
    cleanup();
    delete document.documentElement.dataset.accent;
  });

  it("shows the accessible preset palette and previews the selected accent", () => {
    render(<Harness />);

    const palette = screen.getByRole("radiogroup", { name: "Accent color" });
    const codeUx = within(palette).getByRole("radio", { name: /Code UX/i });
    const violet = within(palette).getByRole("radio", { name: /Violet/i });

    expect(codeUx).toHaveAttribute("aria-checked", "true");
    expect(violet).toHaveAttribute("aria-checked", "false");

    fireEvent.click(violet);

    expect(violet).toHaveAttribute("aria-checked", "true");
    expect(codeUx).toHaveAttribute("aria-checked", "false");
    expect(document.documentElement.dataset.accent).toBe("violet");
  });
});
