/** @vitest-environment jsdom */
import { h } from "preact";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/preact";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { InstructionFileEditorPanel } from "../InstructionFileEditorPanel.js";
import { renderWithI18n, renderWithI18n as render } from "./render-with-i18n.js";
import * as instructionApi from "../../../lib/instruction-file-api.js";

vi.mock("gsap", () => ({
  default: {
    fromTo: vi.fn(),
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
});
