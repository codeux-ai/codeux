// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { useThemeSetting } from "../../../dashboard/src/v2/hooks/useThemeSetting.js";
import * as settingsApi from "../../../dashboard/src/v2/lib/settings-api.js";
import type { SystemSettings } from "../../../dashboard/src/types.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-defaults.js";

const cloneSettings = (): SystemSettings => ({
  defaults: JSON.parse(JSON.stringify(DEFAULT_DASHBOARD_SETTINGS)),
  runtime: {
    dashboardPort: 4444,
    consoleLogLevel: "info",
    debugLogFileLevel: "error",
    consoleLogMode: "standard",
  } as SystemSettings["runtime"],
  integrations: {
    providers: {
      jules: { provider: "jules", name: "Jules", apiKey: "" },
      gemini: { provider: "gemini", name: "Gemini", apiKey: "" },
      codex: { provider: "codex", name: "Codex", apiKey: "" },
      "claude-code": { provider: "claude-code", name: "Claude", apiKey: "" },
    },
    githubToken: "",
  },
  mcpTools: [],
});

const ThemeHarness = () => {
  const { theme, setTheme } = useThemeSetting();
  return (
    <div>
      <button aria-label="navbar-toggle" onClick={() => setTheme(theme === "DARK" ? "LIGHT" : "DARK")}>toggle</button>
      <select aria-label="settings-theme" value={theme} onChange={(event) => setTheme((event.currentTarget as HTMLSelectElement).value as "LIGHT" | "DARK" | "SYSTEM")}>
        <option value="LIGHT">Light</option>
        <option value="DARK">Dark</option>
        <option value="SYSTEM">System</option>
      </select>
      <output aria-label="theme-value">{theme}</output>
    </div>
  );
};

describe("theme toggle/settings synchronization", () => {
  let persistedSettings: SystemSettings;

  beforeEach(() => {
    cleanup();
    vi.restoreAllMocks();
    persistedSettings = cloneSettings();
    persistedSettings.defaults.appearance.theme = "LIGHT";

    vi.spyOn(settingsApi, "fetchSystemSettings").mockImplementation(async () => persistedSettings);
    vi.spyOn(settingsApi, "saveSystemSettings").mockImplementation(async (next) => {
      persistedSettings = JSON.parse(JSON.stringify(next));
      window.dispatchEvent(new CustomEvent("codeux:settings-updated", {
        detail: { scope: "system" },
      }));
      return persistedSettings;
    });
  });

  it("keeps navbar toggle and settings control in sync without reload", async () => {
    const user = userEvent.setup();
    render(<ThemeHarness />);

    await waitFor(() => expect(screen.getByLabelText("theme-value").textContent).toBe("LIGHT"));

    await user.click(screen.getByLabelText("navbar-toggle"));
    await waitFor(() => {
      expect((screen.getByLabelText("settings-theme") as HTMLSelectElement).value).toBe("DARK");
    });

    await user.selectOptions(screen.getByLabelText("settings-theme"), "SYSTEM");
    await waitFor(() => expect(screen.getByLabelText("theme-value").textContent).toBe("SYSTEM"));
  });

  it("hydrates from persisted settings after remount", async () => {
    const user = userEvent.setup();
    const view = render(<ThemeHarness />);

    await waitFor(() => expect(screen.getByLabelText("theme-value").textContent).toBe("LIGHT"));
    await user.click(screen.getByLabelText("navbar-toggle"));
    await waitFor(() => expect(persistedSettings.defaults.appearance.theme).toBe("DARK"));

    view.unmount();
    render(<ThemeHarness />);

    await waitFor(() => {
      expect((screen.getByLabelText("settings-theme") as HTMLSelectElement).value).toBe("DARK");
    });
    expect(screen.getByLabelText("theme-value").textContent).toBe("DARK");
  });
});
