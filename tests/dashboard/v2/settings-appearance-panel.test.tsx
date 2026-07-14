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
import {
  DashboardI18nProvider,
  DASHBOARD_LOCALE_STORAGE_KEY,
} from "../../../dashboard/src/v2/i18n/index.js";
import { SettingsDetailWorkspaceProvider } from "../../../dashboard/src/v2/components/settings/panels/SharedPanelComponents.js";
import type { DashboardAccentColor } from "../../../dashboard/src/types.js";

expect.extend(matchers);

vi.mock("../../../dashboard/src/v2/hooks/useThemeSetting.js", () => ({
  useThemeSetting: () => ({ theme: "SYSTEM", setTheme: vi.fn() }),
}));

const Harness = ({
  activeScope = "system",
  initialAccent,
  onDraftUpdate = vi.fn(),
}: {
  activeScope?: "system" | "project";
  initialAccent?: DashboardAccentColor;
  onDraftUpdate?: ReturnType<typeof vi.fn>;
}) => {
  const [settings, setSettings] = useState(() => {
    const initialSettings = cloneProjectSettings(DEFAULT_DASHBOARD_SETTINGS);
    if (initialAccent) {
      initialSettings.appearance.accentColor = initialAccent;
    }
    return initialSettings;
  });
  return (
    <SettingsAppearancePanel state={{
      activeScope,
      systemSettings: null,
      projectSettings: null,
      selectedProject: null,
      editableSettings: settings,
      updateEditableSettings: (recipe) => {
        onDraftUpdate(recipe);
        setSettings((current) => recipe(current));
      },
      updateSystem: vi.fn(),
      projectSources: {},
    } as any} />
  );
};

describe("SettingsAppearancePanel accent colors", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.lang = "en";
    delete document.documentElement.dataset.accent;
  });

  afterEach(() => {
    cleanup();
    delete document.documentElement.dataset.accent;
  });

  it("shows the accessible preset palette and previews the selected accent", () => {
    render(<DashboardI18nProvider><Harness /></DashboardI18nProvider>);

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

  it("localizes German accent highlights, option labels, descriptions, and animation names", () => {
    const overview = render(
      <DashboardI18nProvider initialLocale="de">
        <SettingsDetailWorkspaceProvider>
          <Harness initialAccent="VIOLET" />
        </SettingsDetailWorkspaceProvider>
      </DashboardI18nProvider>,
    );
    expect(screen.getByText("Violett")).toBeInTheDocument();
    expect(screen.queryByText("Violet")).not.toBeInTheDocument();
    overview.unmount();

    render(<DashboardI18nProvider initialLocale="de"><Harness initialAccent="VIOLET" /></DashboardI18nProvider>);

    const palette = screen.getByRole("radiogroup", { name: "Akzentfarbe" });
    const violet = within(palette).getByRole("radio", {
      name: "Violett. Ein elegantes Violett für einen ausdrucksstärkeren Arbeitsbereich.",
    });
    expect(within(violet).getByText("Violett")).toBeInTheDocument();
    expect(within(palette).getByRole("radio", {
      name: "Ozean. Klares, selbstbewusstes Blau in beiden Designs.",
    })).toBeInTheDocument();

    expect(screen.getByRole("radio", { name: "Tiefer Ozean" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Neonträume" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Polarlicht" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Kosmischer Staub" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Ätherischer Nebel" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Quantenfeld" })).toBeInTheDocument();
  });

  it("switches language immediately, persists it, updates html lang, and announces the change", () => {
    const onDraftUpdate = vi.fn();
    render(<DashboardI18nProvider><Harness onDraftUpdate={onDraftUpdate} /></DashboardI18nProvider>);

    const language = screen.getByRole("radiogroup", { name: "Dashboard language" });
    const english = within(language).getByRole("radio", { name: "English" });
    fireEvent.keyDown(english, { key: "ArrowRight" });

    expect(document.documentElement.lang).toBe("de");
    expect(window.localStorage.getItem(DASHBOARD_LOCALE_STORAGE_KEY)).toBe("de");
    expect(screen.getByText("Dashboard-Sprache auf Deutsch umgestellt.")).toBeInTheDocument();
    expect(screen.getByText("Anzeigeeinstellungen")).toBeInTheDocument();
    expect(onDraftUpdate).not.toHaveBeenCalled();
  });

  it("restores German after remount and falls back to English for an invalid stored locale", () => {
    window.localStorage.setItem(DASHBOARD_LOCALE_STORAGE_KEY, "de");
    const restored = render(<DashboardI18nProvider><Harness /></DashboardI18nProvider>);
    expect(screen.getByRole("radiogroup", { name: "Dashboard-Sprache" })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("de");
    restored.unmount();

    window.localStorage.setItem(DASHBOARD_LOCALE_STORAGE_KEY, "fr");
    render(<DashboardI18nProvider><Harness /></DashboardI18nProvider>);
    expect(screen.getByRole("radiogroup", { name: "Dashboard language" })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("en");
  });

  it("keeps language dashboard-owned in project scope with long mobile-safe helper copy", () => {
    const onDraftUpdate = vi.fn();
    render(<DashboardI18nProvider initialLocale="de"><Harness activeScope="project" onDraftUpdate={onDraftUpdate} /></DashboardI18nProvider>);

    const helper = screen.getByText(/Dies betrifft nur die Dashboard-Oberfläche/);
    expect(helper).toHaveClass("max-w-xl", "leading-relaxed");
    expect(screen.queryByText("Projektüberschreibung")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "English" }));
    expect(onDraftUpdate).not.toHaveBeenCalled();
    expect(document.documentElement.lang).toBe("en");
  });
});
