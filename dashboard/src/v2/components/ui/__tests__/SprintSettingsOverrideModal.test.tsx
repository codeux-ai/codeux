/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_DASHBOARD_SETTINGS } from "../../../../../../src/repositories/settings-defaults.js";
import type { ProjectSettings } from "../../../../types.js";
import { DashboardI18nProvider } from "../../../i18n/context.js";
import type { Sprint } from "../../../types.js";
import {
  fetchSprintEffectiveSettings,
  resetSprintSettings,
  saveSprintSettings,
} from "../../../lib/settings-api.js";
import { SprintSettingsOverrideModal } from "../SprintSettingsOverrideModal.js";

vi.mock("../../../lib/settings-api.js", () => ({
  fetchSprintEffectiveSettings: vi.fn(),
  resetSprintSettings: vi.fn(),
  saveSprintSettings: vi.fn(),
}));

vi.mock("../../settings/ProjectSettingsEditor.js", () => ({
  ProjectSettingsEditor: ({ settings, onChange }: {
    settings: ProjectSettings;
    onChange: (settings: ProjectSettings) => void;
  }) => (
    <button type="button" onClick={() => onChange({
      ...settings,
      git: { ...settings.git, featureBranchPrefix: "verbatim/" },
    })}>
      Testeinstellung ändern
    </button>
  ),
}));

const sprint = {
  id: "sprint-1",
  projectId: "project-1",
  name: "Do not translate this sprint name",
} as unknown as Sprint;

const effectiveSettings = {
  settings: DEFAULT_DASHBOARD_SETTINGS,
  sources: {},
};

const renderModal = (onSaved = vi.fn()) => render(
  <DashboardI18nProvider initialLocale="de" storage={null}>
    <SprintSettingsOverrideModal projectId="project-1" sprint={sprint} onClose={vi.fn()} onSaved={onSaved} />
  </DashboardI18nProvider>,
);

describe("SprintSettingsOverrideModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchSprintEffectiveSettings).mockResolvedValue(effectiveSettings);
    vi.mocked(saveSprintSettings).mockResolvedValue(undefined);
    vi.mocked(resetSprintSettings).mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it("saves an override value unchanged from German controls", async () => {
    const onSaved = vi.fn();
    renderModal(onSaved);

    await screen.findByRole("button", { name: "Testeinstellung ändern" });
    fireEvent.click(screen.getByRole("button", { name: "Testeinstellung ändern" }));
    fireEvent.click(screen.getByRole("button", { name: "Änderungen speichern" }));

    await waitFor(() => expect(saveSprintSettings).toHaveBeenCalledTimes(1));
    expect(saveSprintSettings).toHaveBeenCalledWith(
      "project-1",
      "sprint-1",
      expect.objectContaining({ git: expect.objectContaining({ featureBranchPrefix: "verbatim/" }) }),
    );
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("resets sprint overrides from German controls", async () => {
    const onSaved = vi.fn();
    renderModal(onSaved);

    await screen.findByRole("button", { name: "Zurücksetzen" });
    fireEvent.click(screen.getByRole("button", { name: "Zurücksetzen" }));

    await waitFor(() => expect(resetSprintSettings).toHaveBeenCalledWith("sprint-1"));
    expect(onSaved).toHaveBeenCalledTimes(1);
  });
});
