/** @jsx h */
// @vitest-environment jsdom
import { h } from "preact";
import { render, screen, waitFor, fireEvent } from "@testing-library/preact";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DockerStatusMenu } from "../../../src/v2/components/DockerStatusMenu.js";
import * as matchers from '@testing-library/jest-dom/matchers';
expect.extend(matchers);

// Mock data
const mockContainers = [
  {
    id: "123",
    names: "test-container-1",
    image: "node:18",
    status: "Up 2 hours",
    state: "running",
    runningFor: "2 hours",
    labels: {
      "sprint-os.command": "npm run start"
    }
  },
  {
    id: "456",
    names: "test-container-2",
    image: "postgres:14",
    status: "Exited (0) 5 days ago",
    state: "exited",
    runningFor: "5 days ago",
    labels: {}
  }
];

describe("DockerStatusMenu", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("renders the trigger button", () => {
    render(<DockerStatusMenu />);
    expect(screen.getByRole("button", { name: "Docker Status" })).toBeInTheDocument();
  });

  it("fetches and displays containers on hover", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => mockContainers
    } as Response);

    render(<DockerStatusMenu />);

    // Initial state: dialog is not in document
    expect(screen.queryByRole("dialog", { name: "Active Docker Containers" })).not.toBeInTheDocument();

    // Trigger hover
    const button = screen.getByRole("button", { name: "Docker Status" });
    fireEvent.mouseEnter(button);

    // Dialog should appear
    expect(screen.getByRole("dialog", { name: "Active Docker Containers" })).toBeInTheDocument();

    // Wait for fetch and render
    await waitFor(() => {
      expect(screen.getByText("test-container-1")).toBeInTheDocument();
      expect(screen.getByText("test-container-2")).toBeInTheDocument();
    });

    // Check specific container details
    expect(screen.getByText("node:18")).toBeInTheDocument();
    expect(screen.getByText("2 hours")).toBeInTheDocument();
    expect(screen.getByText("npm run start")).toBeInTheDocument(); // Parsed CLI
  });

  it("closes the popover on mouse leave after a delay", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => mockContainers
    } as Response);

    const { container } = render(<DockerStatusMenu />);

    // Find the wrapper element that handles mouse enter/leave
    const wrapper = container.firstChild as HTMLElement;
    fireEvent.mouseEnter(wrapper);

    // Dialog should appear
    expect(screen.getByRole("dialog", { name: "Active Docker Containers" })).toBeInTheDocument();

    // Trigger leave
    fireEvent.mouseLeave(wrapper);

    // Dialog should still be there immediately (due to 150ms timeout)
    expect(screen.getByRole("dialog", { name: "Active Docker Containers" })).toBeInTheDocument();

    // Fast-forward time
    vi.advanceTimersByTime(200);

    // Dialog should be gone
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Active Docker Containers" })).not.toBeInTheDocument();
    });
  });

  it("shows zero state when no containers exist", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => []
    } as Response);

    const { container } = render(<DockerStatusMenu />);
    const wrapper = container.firstChild as HTMLElement;
    fireEvent.mouseEnter(wrapper);

    await waitFor(() => {
      expect(screen.getByText("No Containers")).toBeInTheDocument();
      expect(screen.getByText("Docker is not running any containers.")).toBeInTheDocument();
    });
  });

  it("handles fetch errors gracefully", async () => {
    // Suppress console.error for this test
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.mocked(fetch).mockRejectedValueOnce(new Error("Network Error"));

    const { container } = render(<DockerStatusMenu />);
    const wrapper = container.firstChild as HTMLElement;
    fireEvent.mouseEnter(wrapper);

    await waitFor(() => {
      expect(screen.getByText("No Containers")).toBeInTheDocument();
    });

    consoleSpy.mockRestore();
  });
});