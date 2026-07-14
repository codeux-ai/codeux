/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/preact";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../../lib/settings.js";
import { DashboardI18nProvider } from "../../../i18n/context.js";
import { translateProjectSettingsLiteral } from "../../../i18n/messages/sprint-authoring.js";
import { dashboardSettingsToProjectSettings } from "../../../lib/settings-view-models.js";
import { ProjectSettingsEditor } from "../ProjectSettingsEditor.js";

afterEach(cleanup);

describe("ProjectSettingsEditor localization", () => {
  it("renders representative German settings labels, descriptions, and generated ARIA descriptions", () => {
    const settings = dashboardSettingsToProjectSettings(DEFAULT_DASHBOARD_SETTINGS);
    settings.git.githubMode = "REMOTE";

    render(
      <DashboardI18nProvider initialLocale="de" storage={null}>
        <ProjectSettingsEditor settings={settings} onChange={() => {}} />
      </DashboardI18nProvider>,
    );

    expect(screen.getByText("Orchestrierungsphasen aktivieren oder deaktivieren und Überwachungszeiten einstellen.")).toBeInTheDocument();
    expect(screen.getByText("CI- und PR-Gate-Auswertung für diesen Bereich aktivieren.")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Branch-Vorprüfung" })).toHaveAttribute(
      "aria-description",
      "Phase „Branch-Vorprüfung“ für diesen Bereich ein- oder ausschalten.",
    );
    expect(screen.getByRole("textbox", { name: "Pfad zur GitHub-Anmeldung" })).toHaveAttribute(
      "aria-description",
      "Eingebundener Laufzeitpfad für Pfad zur GitHub-Anmeldung.",
    );
  });

  it("matches only captured catalog labels case-insensitively and preserves authored values", () => {
    expect(translateProjectSettingsLiteral("de", "Enable cleanup worktree on success for this scope.")).toBe(
      "Worktree nach Erfolg bereinigen für diesen Bereich aktivieren.",
    );
    expect(translateProjectSettingsLiteral("de", "Runtime path mounted for github auth path.")).toBe(
      "Eingebundener Laufzeitpfad für Pfad zur GitHub-Anmeldung.",
    );
    expect(translateProjectSettingsLiteral("de", "branch preflight")).toBe("branch preflight");
    expect(translateProjectSettingsLiteral("de", "Enable branch preflight")).toBe("branch preflight aktivieren");
  });
});
