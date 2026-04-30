/** @jsx h */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { h } from "preact";
import { render, screen, waitFor, fireEvent, cleanup, act } from "@testing-library/preact";
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
    cleanup();
  });

  const getDialog = () => screen.queryByRole("dialog", { name: "Active Docker Containers" });

  it("opens popover on click and traps focus", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => mockContainers
    } as Response);

    const { unmount } = render(<DockerStatusMenu />);
    const button = screen.getByRole("button", { name: "Docker Status" });

    fireEvent.click(button);
    await vi.runAllTimersAsync();

    // Wait for fetch
    await waitFor(() => {
      expect(screen.getByText("test-container-1")).toBeInTheDocument();
    });

    unmount();
  });

  it("closes popover on escape and restores focus", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => mockContainers
    } as Response);

    const { unmount } = render(<DockerStatusMenu />);
    const button = screen.getByRole("button", { name: "Docker Status" });
    button.focus();

    // Open via Enter
    fireEvent.keyDown(button, { key: "Enter" });
    await vi.runAllTimersAsync();

    await waitFor(() => {
        expect(getDialog()).not.toBeNull();
    });

    // Press Escape
    fireEvent.keyDown(document.body, { key: "Escape" });
    await vi.runAllTimersAsync();

    await waitFor(() => {
      expect(getDialog()).toBeNull();
    });

    unmount();
  });

  it("renders the trigger button", () => {
    const { unmount } = render(<DockerStatusMenu />);
    expect(screen.getByRole("button", { name: "Docker Status" })).toBeInTheDocument();
    unmount();
  });

  it("fetches and displays containers on hover", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => mockContainers
    } as Response);

    const { unmount } = render(<DockerStatusMenu />);

    // Trigger hover
    const button = screen.getByRole("button", { name: "Docker Status" });
    const wrapper = button.parentElement as HTMLElement;
    act(() => {
      fireEvent.mouseEnter(wrapper);
    });

    // Wait for state transition
    await act(async () => {
      vi.advanceTimersByTime(10);
    });

    // Dialog should appear
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Active Docker Containers" })).toBeInTheDocument());

    // Wait for fetch and render
    await waitFor(() => {
      expect(screen.getByText("test-container-1")).toBeInTheDocument();
      expect(screen.getByText("test-container-2")).toBeInTheDocument();
    });

    // Check specific container details
    expect(screen.getByText("node:18")).toBeInTheDocument();
    expect(screen.getByText("2 hours")).toBeInTheDocument();
    expect(screen.getByText("npm run start")).toBeInTheDocument(); // Parsed CLI

    unmount();
  });

  it("closes the popover on mouse leave after a delay", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => mockContainers
    } as Response);

    const { unmount } = render(<DockerStatusMenu />);

    // Find the wrapper element that handles mouse enter/leave
    const button = screen.getByRole("button", { name: "Docker Status" });
    const wrapper = button.parentElement as HTMLElement;
    act(() => {
      fireEvent.mouseEnter(wrapper);
    });

    await act(async () => {
      vi.advanceTimersByTime(10);
    });

    // Dialog should appear
    await waitFor(() => {
        expect(getDialog()).not.toBeNull();
    });

    // Trigger leave
    act(() => {
      fireEvent.mouseLeave(wrapper);
    });

    // Fast-forward time
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    // Dialog should be gone
    await waitFor(() => {
      expect(getDialog()).toBeNull();
    });

    unmount();
  });

  it("shows zero state when no containers exist", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => []
    } as Response);

    const { unmount } = render(<DockerStatusMenu />);
    const button = screen.getByRole("button", { name: "Docker Status" });
    const wrapper = button.parentElement as HTMLElement;
    act(() => {
      fireEvent.mouseEnter(wrapper);
    });

    await act(async () => {
      vi.advanceTimersByTime(10);
    });

    await waitFor(() => {
      expect(screen.getByText("No Containers")).toBeInTheDocument();
      expect(screen.getByText("Docker is not running any containers.")).toBeInTheDocument();
    });

    unmount();
  });

  it("handles fetch errors gracefully", async () => {
    // Suppress console.error for this test
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.mocked(fetch).mockRejectedValueOnce(new Error("Network Error"));

    const { unmount } = render(<DockerStatusMenu />);
    const button = screen.getByRole("button", { name: "Docker Status" });
    const wrapper = button.parentElement as HTMLElement;
    act(() => {
      fireEvent.mouseEnter(wrapper);
    });

    await act(async () => {
      vi.advanceTimersByTime(10);
    });

    await waitFor(() => {
      expect(screen.getByText("No Containers")).toBeInTheDocument();
    });

    consoleSpy.mockRestore();
    unmount();
  });
});
