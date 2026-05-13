/** @vitest-environment happy-dom */
/** @jsx h */
import { h } from "preact";
import { render, screen, fireEvent, cleanup } from "@testing-library/preact";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { AddProjectModal } from "../../../dashboard/src/v2/components/ui/AddProjectModal.js";
import { fetchLocalDirectories } from "../../../dashboard/src/v2/lib/project-api.js";

expect.extend(matchers);

vi.mock("gsap", () => ({
  default: {
    fromTo: vi.fn(),
    set: vi.fn(),
    context: (fn: () => void) => {
      fn();
      return { revert: vi.fn() };
    },
    to: vi.fn((_target, options) => {
      options?.onComplete?.();
    }),
  },
}));

vi.mock("../../../dashboard/src/v2/lib/project-api.js", () => ({
  fetchLocalDirectories: vi.fn(),
}));

describe("AddProjectModal", () => {
  beforeEach(() => {
    cleanup();
    vi.mocked(fetchLocalDirectories).mockReset();
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

  it("keeps a stable modal height for local and git project forms", () => {
    render(<AddProjectModal onClose={vi.fn()} onAdd={vi.fn()} />);

    const dialogCard = screen.getByRole("dialog").firstElementChild as HTMLElement;
    expect(dialogCard.style.minHeight).toBe("min(640px, calc(100vh - 2rem))");

    fireEvent.click(screen.getByRole("button", { name: /git url/i }));

    expect(dialogCard.style.minHeight).toBe("min(640px, calc(100vh - 2rem))");
  });

  it("browses into a directory and applies it to the local path input", async () => {
    vi.mocked(fetchLocalDirectories)
      .mockResolvedValueOnce({
        currentPath: "/home/user",
        parentPath: "/home",
        rootPath: "/",
        homePath: "/home/user",
        directories: [{ name: "project", path: "/home/user/project" }],
      })
      .mockResolvedValueOnce({
        currentPath: "/home/user/project",
        parentPath: "/home/user",
        rootPath: "/",
        homePath: "/home/user",
        directories: [],
      });

    render(<AddProjectModal onClose={vi.fn()} onAdd={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /browse/i }));

    expect(await screen.findByText("/home/user")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^project$/i }));

    expect(await screen.findByText("/home/user/project")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^use$/i }));

    expect(screen.getByLabelText("Directory Path")).toHaveValue("/home/user/project");
  });

  it("applies the directory picker selection to the optional clone directory", async () => {
    vi.mocked(fetchLocalDirectories)
      .mockResolvedValueOnce({
        currentPath: "/home/user",
        parentPath: "/home",
        rootPath: "/",
        homePath: "/home/user",
        directories: [{ name: "repos", path: "/home/user/repos" }],
      })
      .mockResolvedValueOnce({
        currentPath: "/home/user/repos",
        parentPath: "/home/user",
        rootPath: "/",
        homePath: "/home/user",
        directories: [],
      });

    render(<AddProjectModal onClose={vi.fn()} onAdd={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /git url/i }));
    fireEvent.click(screen.getByRole("button", { name: /browse/i }));

    expect(await screen.findByText("/home/user")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^repos$/i }));

    expect(await screen.findByText("/home/user/repos")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^use$/i }));

    expect(screen.getByLabelText(/Clone Into Directory/i)).toHaveValue("/home/user/repos");
  });
});
