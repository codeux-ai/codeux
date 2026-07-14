/** @vitest-environment happy-dom */
/** @jsx h */
import { h } from "preact";
import { useState } from "preact/hooks";
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkerPanel } from "../../../dashboard/src/v2/components/settings/panels/WorkerPanel.js";
import { DashboardI18nProvider } from "../../../dashboard/src/v2/i18n/index.js";
import { cloneProjectSettings } from "../../../dashboard/src/v2/lib/settings/project-overrides.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-defaults.js";
import type { ProjectSettings } from "../../../dashboard/src/types.js";

afterEach(() => cleanup());

describe("WorkerPanel", () => {
  it("localizes German numeric validation while preserving worker setting values", () => {
    let latestSettings = cloneProjectSettings(DEFAULT_DASHBOARD_SETTINGS);

    const Harness = () => {
      const [settings, setSettings] = useState(latestSettings);
      const update = (patch: Partial<ProjectSettings>): void => {
        setSettings((current) => {
          const next = { ...current, ...patch };
          latestSettings = next;
          return next;
        });
      };

      return (
        <DashboardI18nProvider initialLocale="de">
          <WorkerPanel settings={settings} update={update} getBadge={vi.fn()} />
        </DashboardI18nProvider>
      );
    };

    render(<Harness />);

    const maxConcurrency = screen.getByRole("spinbutton", { name: "Maximale Parallelität" });
    fireEvent.input(maxConcurrency, { target: { value: "0" } });
    expect(latestSettings.workers.maxConcurrency).toBe(0);
    expect(screen.getByRole("alert")).toHaveTextContent("Verwende einen Wert von mindestens 1.");

    const dispatchTimeout = screen.getByRole("spinbutton", { name: "Dispatch-Zeitüberschreitung" });
    fireEvent.input(dispatchTimeout, { target: { value: "3601" } });
    expect(latestSettings.workers.timeoutSeconds).toBe(3601);
    expect(screen.getAllByRole("alert")[1]).toHaveTextContent("Verwende einen Wert von höchstens 3600.");
  });
});
