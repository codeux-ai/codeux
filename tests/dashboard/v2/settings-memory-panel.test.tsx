/** @vitest-environment jsdom */
import { render, screen, cleanup } from "@testing-library/preact";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../dashboard/src/lib/settings.js";
import { SettingsMemoryPanel } from "../../../dashboard/src/v2/components/settings/panels/SettingsMemoryPanel.js";
import { DashboardI18nProvider } from "../../../dashboard/src/v2/i18n/index.js";
import { SettingsDetailWorkspaceProvider } from "../../../dashboard/src/v2/components/settings/panels/SharedPanelComponents.js";

describe("SettingsMemoryPanel internationalization", () => {
  afterEach(cleanup);

  it("renders German remediation controls and locale-aware memory measurements", async () => {
    const editableSettings = {
      ...DEFAULT_DASHBOARD_SETTINGS,
      memory: {
        ...DEFAULT_DASHBOARD_SETTINGS.memory,
        maxSprintMemories: 1_234,
        remediationMode: "ai" as const,
      },
    };

    render(
      <DashboardI18nProvider initialLocale="de" storage={null}>
        <SettingsDetailWorkspaceProvider>
          <SettingsMemoryPanel state={{
            activeScope: "system",
            selectedProject: null,
            editableSettings,
            projectSources: {},
            updateEditableSettings: () => undefined,
          } as any} />
        </SettingsDetailWorkspaceProvider>
      </DashboardI18nProvider>,
    );

    expect(screen.getByText("Speichersystem")).toBeInTheDocument();
    expect(screen.getByText("max. 1.234")).toBeInTheDocument();
    expect(screen.getByText("Zeitplan für langfristige Bereinigung")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Konfigurieren Speichersystem" }));
    expect(screen.getAllByText("KI-Bereinigung").length).toBeGreaterThan(0);
  });
});
