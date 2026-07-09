/** @vitest-environment happy-dom */
/** @jsx h */
import { h } from "preact";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
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

  it("cancels destructive actions with Escape and restores focus to the trigger", async () => {
    const handleDeleteProject = vi.fn();

    render(
      <main>
        <SettingsDangerPanel
          state={makeState({ handleDeleteProject }) as any}
        />
      </main>,
    );

    const trigger = screen.getByRole("button", { name: /^delete project$/i });
    trigger.focus();
    fireEvent.click(trigger);

    expect(screen.getByRole("dialog", { name: "Delete Project" })).toHaveAttribute("aria-modal", "true");

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Delete Project" })).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });
    expect(handleDeleteProject).not.toHaveBeenCalled();
  });

  it("keeps disabled destructive actions named and busy while pending", () => {
    render(
      <SettingsDangerPanel
        state={makeState({
          deletingProject: true,
          memoryClearBusy: "project:short_term",
        }) as any}
      />,
    );

    const deleteProject = screen.getByRole("button", { name: /^delete project$/i });
    expect(deleteProject).toHaveAttribute("aria-busy", "true");
    expect(deleteProject).toHaveAttribute("aria-disabled", "true");
    expect(deleteProject).toHaveTextContent("Delete Project in progress");

    const clearShortTerm = screen.getByRole("button", { name: /^clear short-term$/i });
    expect(clearShortTerm).toHaveAttribute("aria-busy", "true");
    expect(clearShortTerm).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: /^clear long-term$/i })).toBeDisabled();
  });
});
