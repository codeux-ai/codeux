/** @vitest-environment jsdom */
import { h } from "preact";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/preact";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { InstructionFileEditorPanel } from "../InstructionFileEditorPanel.js";
import { renderWithI18n, renderWithI18n as render } from "./render-with-i18n.js";
import * as instructionApi from "../../../lib/instruction-file-api.js";
import gsap from "gsap";
import type { AgentEditorNavigationState } from "../editor-navigation-state.js";

vi.mock("gsap", () => ({
  default: {
    fromTo: vi.fn().mockImplementation((_, __, config) => config?.onComplete?.()),
    to: vi.fn().mockImplementation((_, config) => config?.onComplete?.()),
    killTweensOf: vi.fn(),
  },
}));

vi.mock("../../providers/ProviderBrandIcon.js", () => ({
  ProviderBrandIcon: () => <span data-testid="provider-brand" />,
}));

vi.mock("../../ui/BorderTrace.js", () => ({
  BorderTrace: () => null,
}));

vi.mock("../../../../lib/markdown.js", () => ({
  renderMarkdown: (value: string) => `<p>${value}</p>`,
}));

const file = {
  id: "instructions",
  label: "AGENTS.md",
  fileName: "AGENTS.md",
  relativePath: "AGENTS.md",
  description: "Agent instructions",
  exists: true,
  size: 42,
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("InstructionFileEditorPanel", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  test("focuses blank required content on save and shows retry feedback", async () => {
    vi.spyOn(instructionApi, "fetchInstructionFile").mockResolvedValue({ ...file, content: "Existing guidance" });
    const saveSpy = vi.spyOn(instructionApi, "saveInstructionFile").mockResolvedValue({ ...file, content: "Saved" });

    render(<InstructionFileEditorPanel projectId="project_1" file={file} onSaved={vi.fn()} />);

    const textarea = await screen.findByPlaceholderText(/Write the instructions/);
    fireEvent.input(textarea, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getAllByText(/Instruction file content is required/).length).toBeGreaterThan(0);
    });
    await waitFor(() => expect(textarea).toHaveFocus());
    expect(saveSpy).not.toHaveBeenCalled();
  });

  test("localizes German file chrome while preserving Markdown verbatim", async () => {
    const content = "# Keep this heading\n\nDo not translate this guidance.";
    vi.spyOn(instructionApi, "fetchInstructionFile").mockResolvedValue({ ...file, content });

    renderWithI18n(<InstructionFileEditorPanel projectId="project_1" file={file} onSaved={vi.fn()} />, "de");

    expect(await screen.findByText("Anweisungsdatei ist gespeichert.")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue(content);
    expect(screen.getByRole("button", { name: "Speichern" })).toBeInTheDocument();
  });

  test("uses the shared named dialog for revert cancellation and restores the exact trigger focus", async () => {
    vi.spyOn(instructionApi, "fetchInstructionFile").mockResolvedValue({ ...file, content: "Existing guidance" });
    const nativeConfirm = vi.spyOn(window, "confirm");

    render(<InstructionFileEditorPanel projectId="project_1" file={file} onSaved={vi.fn()} />);
    const textarea = await screen.findByRole("textbox");
    fireEvent.input(textarea, { target: { value: "Draft guidance" } });

    const revertButton = screen.getByRole("button", { name: "Revert changes" });
    revertButton.focus();
    fireEvent.click(revertButton);

    expect(await screen.findByRole("dialog", { name: "Revert changes to AGENTS.md?" })).toBeInTheDocument();
    expect(screen.getByText("This replaces the unsaved AGENTS.md draft with its last saved content.")).toBeInTheDocument();
    expect(revertButton).toBeDisabled();
    expect(nativeConfirm).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(textarea).toHaveValue("Draft guidance");
    await waitFor(() => expect(revertButton).toHaveFocus());
  });

  test("reverts only after shared-dialog confirmation", async () => {
    vi.spyOn(instructionApi, "fetchInstructionFile").mockResolvedValue({ ...file, content: "Existing guidance" });

    render(<InstructionFileEditorPanel projectId="project_1" file={file} onSaved={vi.fn()} />);
    const textarea = await screen.findByRole("textbox");
    fireEvent.input(textarea, { target: { value: "Draft guidance" } });
    fireEvent.click(screen.getByRole("button", { name: "Revert changes" }));
    const dialog = await screen.findByRole("dialog", { name: "Revert changes to AGENTS.md?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Revert changes" }));

    await waitFor(() => expect(textarea).toHaveValue("Existing guidance"));
  });

  test("keeps a failed save draft open through the parent editor-state contract", async () => {
    vi.spyOn(instructionApi, "fetchInstructionFile").mockResolvedValue({ ...file, content: "Existing guidance" });
    vi.spyOn(instructionApi, "saveInstructionFile").mockRejectedValue(new Error("Disk unavailable"));
    const reportedStates: AgentEditorNavigationState[] = [];

    render(
      <InstructionFileEditorPanel
        projectId="project_1"
        file={file}
        onSaved={vi.fn()}
        onEditorStateChange={(_editorKey, state) => { if (state) reportedStates.push(state); }}
      />
    );
    const textarea = await screen.findByRole("textbox");
    fireEvent.input(textarea, { target: { value: "Draft guidance" } });
    await waitFor(() => expect(reportedStates.at(-1)?.dirty).toBe(true));

    let saved = true;
    await act(async () => {
      saved = await reportedStates.at(-1)!.save();
    });

    expect(saved).toBe(false);
    expect(textarea).toHaveValue("Draft guidance");
    expect(screen.getByText("Disk unavailable")).toBeInTheDocument();
    expect(reportedStates.at(-1)?.dirty).toBe(true);
  });

  test("uses reduced selection motion while retaining a static selected-editor cue", async () => {
    vi.spyOn(instructionApi, "fetchInstructionFile").mockResolvedValue({ ...file, content: "Existing guidance" });
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: vi.fn((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) });

    const view = render(<InstructionFileEditorPanel projectId="project_1" file={file} onSaved={vi.fn()} />);
    await screen.findByRole("textbox");

    expect(view.container.querySelector("[data-editor-selected='true']")).toBeInTheDocument();
    expect(gsap.fromTo).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ opacity: 1, x: 0 }),
      expect.objectContaining({ duration: 0 }),
    );
    Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: originalMatchMedia });
  });
});
