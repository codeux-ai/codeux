/**
 * @vitest-environment jsdom
 */
import { render, screen, cleanup, waitFor } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, afterEach } from "vitest";
import { ProjectSettingsEditor } from "../../dashboard/src/v2/components/settings/ProjectSettingsEditor.jsx";
import { TextInput } from "../../dashboard/src/v2/components/settings/SettingsFormFields.js";
import * as matchers from '@testing-library/jest-dom/matchers';
expect.extend(matchers);

describe("ProjectSettingsEditor", () => {
  const originalMatchMedia = window.matchMedia;

  afterEach(() => {
    cleanup();
    window.matchMedia = originalMatchMedia;
  });

  it("renders Max Parsing Retries input and passes updates correctly", async () => {
    const mockOnChange = vi.fn();
    const mockSettings = {
      cliWorkflow: {
        maxParsingRetries: 3
      },
      workers: {
        executionMode: "CONTAINERS",
        virtualWorkerProvider: "jules"
      },
      agents: {
        qualityAssurance: {
          enabled: false
        }
      },
      aiProvider: {
        providers: {
          jules: { provider: "jules" }
        }
      },
      git: {},
      memory: {},
      automationInterventions: {},
      ciIntelligence: {},
      sprintLoopSteps: {},
      sprintPreview: {
        enabled: false
      },
      skills: [],
      mcpTools: []
    };

    render(
      <ProjectSettingsEditor
        settings={mockSettings as any}
        onChange={mockOnChange}
      />
    );

    const inputs = screen.getAllByRole("spinbutton");
    const input = inputs.find(i => (i as HTMLInputElement).value === "3");

    expect(input).toBeInTheDocument();

    await userEvent.clear(input!);
    await userEvent.type(input!, "5");

    expect(mockOnChange).toHaveBeenCalledWith(expect.objectContaining({
        cliWorkflow: expect.objectContaining({ maxParsingRetries: 5 })
    }));
  });

  it("keeps helper text wired until validation is revealed by explicit submit", async () => {
    const { rerender } = render(
      <TextInput
        value=""
        onChange={vi.fn()}
        aria-label="Provider display name"
        helperText="Used in provider route summaries."
        errorText="Display name is required."
      />
    );

    const input = screen.getByLabelText("Provider display name");
    expect(input).toHaveAccessibleDescription("Used in provider route summaries.");
    expect(input).not.toHaveAttribute("aria-errormessage");
    expect(screen.queryByRole("alert")).toBeNull();

    rerender(
      <TextInput
        value=""
        onChange={vi.fn()}
        aria-label="Provider display name"
        helperText="Used in provider route summaries."
        errorText="Display name is required."
        forceValidation
      />
    );

    await waitFor(() => expect(input).toHaveAttribute("aria-invalid", "true"));
    expect(input).toHaveAccessibleDescription("Display name is required.");
    expect(input).toHaveAttribute("aria-errormessage", expect.stringContaining("error"));
    expect(screen.getByRole("alert")).toHaveTextContent("Display name is required.");
  });

  it("resolves validation feedback duration to zero when reduced motion is preferred", () => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true,
      media: "(prefers-reduced-motion: reduce)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }) as any;

    render(
      <TextInput
        value="1234567890"
        onChange={vi.fn()}
        maxLength={10}
        aria-label="Reduced motion counter"
      />
    );

    const counter = screen.getByText("10 / 10");
    expect(counter).toHaveStyle({ animationDuration: "0ms" });
  });
});
