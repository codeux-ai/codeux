/** @vitest-environment jsdom */
/** @jsx h */
import { h } from "preact";
import { render, screen, fireEvent, cleanup } from "@testing-library/preact";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { AddProjectModal } from "../../../dashboard/src/v2/components/ui/AddProjectModal.js";

expect.extend(matchers);

vi.mock("gsap", () => ({
  default: {
    fromTo: vi.fn(),
    to: vi.fn((_target, options) => {
      options?.onComplete?.();
    }),
  },
}));

describe("AddProjectModal", () => {
  beforeEach(() => {
    cleanup();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("prefers the autofocus field when the modal opens", () => {
    render(<AddProjectModal onClose={vi.fn()} onAdd={vi.fn()} />);

    const nameInput = screen.getByLabelText("Project Name");

    vi.advanceTimersByTime(60);

    expect(document.activeElement).toBe(nameInput);
  });

  it("keeps focus on the name field while typing", () => {
    render(<AddProjectModal onClose={vi.fn()} onAdd={vi.fn()} />);

    const nameInput = screen.getByLabelText("Project Name") as HTMLInputElement;
    nameInput.focus();

    fireEvent.input(nameInput, { target: { value: "A" } });
    vi.advanceTimersByTime(60);

    expect(nameInput.value).toBe("A");
    expect(document.activeElement).toBe(nameInput);
  });
});
