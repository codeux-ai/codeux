/** @vitest-environment jsdom */
import { h } from "preact";
import { render, screen } from "@testing-library/preact";
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi } from "vitest";
import { InstructionFileCard } from "../InstructionFileCard.js";
import type { InstructionFileSummary } from "../../../lib/instruction-file-api.js";

vi.mock("gsap", () => ({
  default: {
    fromTo: vi.fn(),
  },
}));

vi.mock("../../providers/ProviderBrandIcon.js", () => ({
  ProviderBrandIcon: () => <span data-testid="provider-brand-icon" />,
}));

const makeFile = (overrides: Partial<InstructionFileSummary> = {}): InstructionFileSummary => ({
  id: "codex",
  label: "Codex Instructions",
  fileName: "AGENTS.md",
  relativePath: ".code-ux/instructions/AGENTS.md",
  description: "Codex instructions",
  providerId: "codex",
  exists: true,
  size: 2048,
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

describe("InstructionFileCard", () => {
  test("exposes instruction-file status and selection to assistive technology", () => {
    render(<InstructionFileCard file={makeFile()} isSelected={true} onClick={vi.fn()} />);

    const card = screen.getByRole("button", {
      name: "Open instruction file Codex Instructions. 2.0 KB on disk.",
    });

    expect(card).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText(".code-ux/instructions/AGENTS.md")).toBeInTheDocument();
    expect(screen.getByTestId("provider-brand-icon")).toBeInTheDocument();
  });

  test("labels missing instruction files as new without using an error color", () => {
    render(<InstructionFileCard file={makeFile({ exists: false, size: 0 })} isSelected={false} onClick={vi.fn()} />);

    expect(screen.getByRole("button", {
      name: "Open instruction file Codex Instructions. Not created yet.",
    })).toBeInTheDocument();
    expect(screen.getByText("New")).toBeInTheDocument();
  });
});
