/** @vitest-environment happy-dom */
/** @jsx h */
import { h } from "preact";
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsDangerPanel } from "../../../dashboard/src/v2/components/settings/panels/SettingsDangerPanel.js";

expect.extend(matchers);

afterEach(() => {
  cleanup();
});

const makeState = (overrides: Record<string, unknown> = {}) => ({
  activeScope: "project",
  selectedProject: { id: "proj-1", name: "Approved local test project" },
  resettingProject: false,
  deletingProject: false,
  resettingDatabase: false,
  memoryClearBusy: null,
  handleResetProject: vi.fn(),
  handleDeleteProject: vi.fn(),
  handleResetDatabase: vi.fn(),
  handleClearMemory: vi.fn(),
  ...overrides,
});

describe("SettingsDangerPanel", () => {
  it("keeps project reset in the danger zone behind confirmation", () => {
    const handleResetProject = vi.fn();

    render(
      <SettingsDangerPanel
        state={makeState({ handleResetProject }) as any}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^reset project$/i }));

    expect(handleResetProject).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: /reset project overrides/i })).toBeInTheDocument();
    expect(screen.getByText(/clear saved settings overrides/i)).toBeInTheDocument();
  });
});
