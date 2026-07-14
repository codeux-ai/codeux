/** @vitest-environment happy-dom */
/** @jsx h */
import { h } from "preact";
import { useState } from "preact/hooks";
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { SettingsBrowserPanel } from "../../../dashboard/src/v2/components/settings/panels/SettingsBrowserPanel.js";
import { DashboardI18nProvider } from "../../../dashboard/src/v2/i18n/index.js";
import { cloneProjectSettings } from "../../../dashboard/src/v2/lib/settings/project-overrides.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-defaults.js";
import type { ProjectSettings } from "../../../dashboard/src/types.js";

afterEach(() => cleanup());

describe("SettingsBrowserPanel", () => {
  it("renders German browser controls while preserving booleans, commands, and numeric validation boundaries", () => {
    let latestSettings = cloneProjectSettings(DEFAULT_DASHBOARD_SETTINGS);

    const Harness = () => {
      const [settings, setSettings] = useState(latestSettings);
      return (
        <DashboardI18nProvider initialLocale="de">
          <SettingsBrowserPanel
            state={{
              activeScope: "project",
              editableSettings: settings,
              projectSources: {},
              updateEditableSettings: (recipe: (value: ProjectSettings) => ProjectSettings) => {
                setSettings((current) => {
                  const next = recipe(current);
                  latestSettings = next;
                  return next;
                });
              },
            } as never}
          />
        </DashboardI18nProvider>
      );
    };

    render(<Harness />);

    expect(screen.getByRole("heading", { name: "Sichtbarkeit des Arbeitsbereichs" })).toBeInTheDocument();
    const browserToggle = screen.getAllByRole("switch", { name: "Einstellung umschalten" })[1];
    fireEvent.click(browserToggle);
    expect(latestSettings.sprintPreview.showInAppBrowser).toBe(
      !DEFAULT_DASHBOARD_SETTINGS.sprintPreview.showInAppBrowser,
    );

    const maxContainers = screen.getByRole("spinbutton", { name: "Maximale aktive Vorschau-Container" });
    fireEvent.input(maxContainers, { target: { value: "0" } });
    fireEvent.blur(maxContainers);
    expect(latestSettings.sprintPreview.maxConcurrentContainers).toBe(0);
    expect(screen.getByRole("alert")).toHaveTextContent("Verwende einen Wert von mindestens 1.");

    const startupCommand = screen.getByRole("textbox", { name: "Standard-Startbefehl" });
    expect(startupCommand).toHaveAttribute("placeholder", "pnpm dev --host 0.0.0.0");
    fireEvent.input(startupCommand, { target: { value: "pnpm preview --host 0.0.0.0" } });
    expect(latestSettings.sprintPreview.startupCommand).toBe("pnpm preview --host 0.0.0.0");
  });
});
