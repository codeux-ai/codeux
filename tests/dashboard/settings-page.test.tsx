/**
 * @vitest-environment jsdom
 */
import { render, screen, cleanup } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, afterEach } from "vitest";
import { ProjectSettingsEditor } from "../../dashboard/src/v2/components/settings/ProjectSettingsEditor.jsx";
import * as matchers from '@testing-library/jest-dom/matchers';
expect.extend(matchers);

describe("ProjectSettingsEditor", () => {
  afterEach(() => {
    cleanup();
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
});
