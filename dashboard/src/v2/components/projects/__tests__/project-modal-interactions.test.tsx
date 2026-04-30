/**
 * @vitest-environment jsdom
 */
import { h } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, act } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import * as matchers from "@testing-library/jest-dom/matchers";
expect.extend(matchers);

// Mock gsap for components potentially using it
vi.mock("gsap", () => ({
  default: {
    to: vi.fn().mockImplementation((el, config) => {
        if (config?.onComplete) config.onComplete();
    }),
    fromTo: vi.fn().mockImplementation((el, from, config) => {
        if (config?.onComplete) config.onComplete();
    }),
    set: vi.fn(),
    killTweensOf: vi.fn(),
    context: vi.fn((cb) => {
      cb();
      return { revert: vi.fn() };
    })
  }
}));

// Mock useReducedMotion
vi.mock("../../hooks/use-reduced-motion.js", () => ({
    useReducedMotion: () => true
}));

// Mock Confirm Dialog
vi.mock("../../hooks/use-confirm-dialog.js", () => ({
    useConfirmDialog: () => ({ requestConfirm: vi.fn().mockResolvedValue(true) })
}));

import { AddProjectModal } from "../../ui/AddProjectModal.js";

afterEach(() => {
  cleanup();
});

describe("AddProjectModal Interactions", () => {
  it("renders Local Path inputs initially, switches to Git URL when toggled", async () => {
    const { getByText, queryByText, getByRole } = render(
      <AddProjectModal onClose={() => {}} onAdd={() => {}} />
    );

    // Initial state check
    expect(getByText(/Directory Path/)).toBeInTheDocument();
    expect(queryByText(/Repository URL/)).not.toBeInTheDocument();

    // Toggle to Git URL
    const gitButton = getByRole("button", { name: /Git URL/ });
    await userEvent.click(gitButton);

    // State after toggle
    expect(getByText(/Repository URL/)).toBeInTheDocument();
    expect(queryByText(/Directory Path/)).not.toBeInTheDocument();
  });

  it("calls onClose when Cancel is clicked", async () => {
    const onClose = vi.fn();
    const { getByText } = render(
      <AddProjectModal onClose={onClose} onAdd={() => {}} />
    );

    const cancelButton = getByText("Cancel");
    await act(async () => {
      await userEvent.click(cancelButton);
    });

    // AddProjectModal triggers closing animation before firing `onClose`
    // The animation onComplete callback calls onClose.
    // If we mocked gsap earlier without actually calling onComplete in the `to` mock, it won't fire!
    // We should ensure our GSAP mock invokes onComplete immediately if present.
    // However, in motion-reduced.test.tsx we mocked gsap, here we did too!

    // Let's manually trigger onClose if gsap wasn't configured to call onComplete.
    // Or we fix the gsap mock for this file!
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onAdd with Local Path data on successful submit", async () => {
    const onAdd = vi.fn();
    const { getByRole, getByPlaceholderText } = render(
      <AddProjectModal onClose={() => {}} onAdd={onAdd} />
    );

    const nameField = getByPlaceholderText("My Awesome Project");
    const localPathField = getByPlaceholderText("/home/user/projects/my-project");

    await userEvent.type(nameField, "Test Project");
    await userEvent.type(localPathField, "/test/path");

    const submitButton = getByRole("button", { name: /Add Project/i });

    await act(async () => {
        await userEvent.click(submitButton);
    });

    expect(onAdd).toHaveBeenCalledWith({
        name: "Test Project",
        type: "local",
        path: "/test/path"
    });
  });

  it("calls onAdd with Git URL data on successful submit", async () => {
    const onAdd = vi.fn();
    const { getByRole, getByPlaceholderText } = render(
      <AddProjectModal onClose={() => {}} onAdd={onAdd} />
    );

    const gitButton = getByRole("button", { name: /Git URL/ });
    await userEvent.click(gitButton);

    const nameField = getByPlaceholderText("My Awesome Project");
    const gitUrlField = getByPlaceholderText("https://github.com/user/repo.git");
    const cloneDirField = getByPlaceholderText("/home/user/projects");

    await userEvent.type(nameField, "Git Project");
    await userEvent.type(gitUrlField, "https://github.com/test.git");
    await userEvent.type(cloneDirField, "/test/clone/dir");

    const submitButton = getByRole("button", { name: /Add Project/i });

    await act(async () => {
        await userEvent.click(submitButton);
    });

    expect(onAdd).toHaveBeenCalledWith({
        name: "Git Project",
        type: "git",
        path: "https://github.com/test.git",
        cloneDir: "/test/clone/dir"
    });
  });
});