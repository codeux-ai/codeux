/** @vitest-environment happy-dom */
/** @jsx h */
/** @jsxFrag Fragment */
import { h, Fragment } from "preact";
import { useState } from "preact/hooks";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { cloneDefaultSettings } from "../../../dashboard/src/lib/settings.js";
import { SettingsGuidancePanel } from "../../../dashboard/src/v2/components/settings/panels/SettingsGuidancePanel.js";
import type { ProjectSettings } from "../../../dashboard/src/types.js";
import { DESIGN_GUIDANCE_NONE_ID } from "../../../src/domain/settings/design-guidance-catalog.js";

expect.extend(matchers);

vi.mock("gsap", () => ({
  default: {
    context: (callback: () => void) => {
      callback();
      return { revert: vi.fn() };
    },
    fromTo: vi.fn(),
    set: vi.fn(),
    to: vi.fn((_: unknown, options?: { onComplete?: () => void }) => {
      options?.onComplete?.();
    }),
  },
}));

vi.mock("../../../dashboard/src/v2/hooks/use-reduced-motion.js", () => ({
  useResolvedMotionDuration: (duration: string) => duration,
  useReducedMotion: () => true,
}));

afterEach(() => {
  cleanup();
});

describe("SettingsGuidancePanel", () => {
  it("adds, edits, selects, and deletes custom guidance entries without editing defaults", async () => {
    let latestSettings: ProjectSettings = cloneDefaultSettings();
    const updateEditableSettings = vi.fn();

    const Harness = () => {
      const [settings, setSettings] = useState<ProjectSettings>(latestSettings);
      updateEditableSettings.mockImplementation((recipe: (current: ProjectSettings) => ProjectSettings) => {
        setSettings((current) => {
          const next = recipe(current);
          latestSettings = next;
          return next;
        });
      });

      return (
        <SettingsGuidancePanel
          state={{
            activeScope: "system",
            activeSaving: false,
            editableSettings: settings,
            selectedProject: { id: "proj-1", name: "Test Project" },
            projectSources: {},
            updateEditableSettings,
            getFieldReset: () => undefined,
          } as never}
        />
      );
    };

    render(<Harness />);

    expect(screen.getByText("Tech Stack")).toBeInTheDocument();
    expect(screen.getByText("Styleguide")).toBeInTheDocument();
    expect(screen.getAllByText(/Built-ins are protected/i)).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Add Tech Stack" }));

    await waitFor(() => {
      expect(latestSettings.designGuidance.customTechStacks).toHaveLength(1);
      expect(latestSettings.designGuidance.selectedTechStackId).toBe("custom-tech-stack");
      expect(screen.getByDisplayValue("Custom Tech Stack")).toBeInTheDocument();
    });

    fireEvent.input(screen.getByLabelText(/Tech Stack guidance name/i), {
      target: { value: "Internal UI Stack" },
    });

    await waitFor(() => {
      expect(latestSettings.designGuidance.customTechStacks[0]?.name).toBe("Internal UI Stack");
      expect(screen.getByText("Active: Internal UI Stack")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete Internal UI Stack" }));

    await waitFor(() => {
      expect(latestSettings.designGuidance.customTechStacks).toHaveLength(0);
      expect(latestSettings.designGuidance.selectedTechStackId).toBe(DESIGN_GUIDANCE_NONE_ID);
    });
  });

  it("hides default styleguides while preserving None and custom styleguides", async () => {
    let latestSettings: ProjectSettings = cloneDefaultSettings();
    const updateEditableSettings = vi.fn();

    const Harness = () => {
      const [settings, setSettings] = useState<ProjectSettings>(latestSettings);
      updateEditableSettings.mockImplementation((recipe: (current: ProjectSettings) => ProjectSettings) => {
        setSettings((current) => {
          const next = recipe(current);
          latestSettings = next;
          return next;
        });
      });

      return (
        <SettingsGuidancePanel
          state={{
            activeScope: "system",
            activeSaving: false,
            editableSettings: settings,
            selectedProject: { id: "proj-1", name: "Test Project" },
            projectSources: {},
            updateEditableSettings,
            getFieldReset: () => undefined,
          } as never}
        />
      );
    };

    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "Add Styleguide" }));

    await waitFor(() => {
      expect(latestSettings.designGuidance.customStyleguides).toHaveLength(1);
      expect(latestSettings.designGuidance.selectedStyleguideId).toBe("custom-styleguide");
    });

    fireEvent.click(screen.getByRole("switch", { name: "Hide default styleguides" }));

    await waitFor(() => {
      expect(latestSettings.designGuidance.hideDefaultStyleguides).toBe(true);
      expect(latestSettings.designGuidance.selectedStyleguideId).toBe("custom-styleguide");
    });

    fireEvent.click(screen.getAllByRole("button", { name: "Clear" }).at(-1)!);

    await waitFor(() => {
      expect(latestSettings.designGuidance.selectedStyleguideId).toBe(DESIGN_GUIDANCE_NONE_ID);
      expect(latestSettings.designGuidance.customStyleguides[0]?.id).toBe("custom-styleguide");
    });
  });
});
