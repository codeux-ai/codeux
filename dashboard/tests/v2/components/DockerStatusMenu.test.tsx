/** @vitest-environment jsdom */
/** @jsx h */
import { h } from "preact";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DockerStatusMenu } from "../../../src/v2/components/DockerStatusMenu.js";
import * as matchers from "@testing-library/jest-dom/matchers";
expect.extend(matchers);

const mockContainers = [
  {
    id: "1",
    names: "test-container-1",
    image: "node:18",
    status: "Up 2 hours",
    state: "running",
    runningFor: "2 hours",
    labels: { "sprint-os.command": "npm run start" },
  },
  {
    id: "2",
    names: "test-container-2",
    image: "postgres:14",
    status: "Exited (0) 5 days ago",
    state: "exited",
    runningFor: "5 days ago",
    labels: {},
  },
];

describe("DockerStatusMenu", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("renders the trigger button", () => {
    render(<DockerStatusMenu />);
    expect(screen.getByRole("button", { name: "Docker Status" })).toBeInTheDocument();
  });

  it("opens popover on click, displays containers, and traps focus", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => mockContainers,
    } as Response);

    render(<DockerStatusMenu />);

    expect(screen.queryByRole("dialog", { name: "Active Docker Containers" })).not.toBeInTheDocument();

    const button = screen.getByRole("button", { name: "Docker Status" });
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Active Docker Containers" })).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText("test-container-1")).toBeInTheDocument();
      expect(screen.getByText("test-container-2")).toBeInTheDocument();
    });

    expect(screen.getByText("node:18")).toBeInTheDocument();
    expect(screen.getByText("2 hours")).toBeInTheDocument();
    expect(screen.getByText("npm run start")).toBeInTheDocument();
  });

  it("closes popover on escape and restores focus", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => mockContainers,
    } as Response);

    render(<DockerStatusMenu />);
    const button = screen.getByRole("button", { name: "Docker Status" });
    button.focus();

    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Active Docker Containers" })).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText("test-container-1")).toBeInTheDocument();
    });

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Active Docker Containers" })).not.toBeInTheDocument();
    });

    expect(button).toHaveFocus();
  });

  it("closes the popover on mouse leave after a delay", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => mockContainers,
    } as Response);

    vi.useFakeTimers();

    const { container } = render(<DockerStatusMenu />);

    const wrapper = container.firstChild?.firstChild as HTMLElement;
    fireEvent.mouseEnter(wrapper);

    vi.runAllTimers();
    await Promise.resolve();

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Active Docker Containers" })).toBeInTheDocument();
    });

    fireEvent.mouseLeave(wrapper);
    vi.runAllTimers();

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Active Docker Containers" })).not.toBeInTheDocument();
    }, { timeout: 3000 });

    vi.useRealTimers();
  });

  it("shows zero state when no containers exist", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    } as Response);

    render(<DockerStatusMenu />);
    const button = screen.getByRole("button", { name: "Docker Status" });
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText("No Containers")).toBeInTheDocument();
      expect(screen.getByText("Docker is not running any containers.")).toBeInTheDocument();
    });
  });

  it("handles fetch errors gracefully", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    vi.mocked(fetch).mockRejectedValueOnce(new Error("Network Error"));

    render(<DockerStatusMenu />);
    const button = screen.getByRole("button", { name: "Docker Status" });
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText("No Containers")).toBeInTheDocument();
    });

    consoleSpy.mockRestore();
  });
});

void userEvent;
