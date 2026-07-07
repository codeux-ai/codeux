/** @vitest-environment jsdom */
/** @jsx h */
import { h } from "preact";
import { render, screen, waitFor, fireEvent, cleanup, within } from "@testing-library/preact";
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
    labels: { "code-ux.command": "npm run start" },
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

const mockReadiness = {
  checkedAt: "2026-05-12T00:00:00.000Z",
  cluster: {
    status: "ready",
    label: "Cluster ready",
    detail: "Required local runtime dependencies are available.",
  },
  dependencies: [],
  providers: [],
};

const mockNotReadyReadiness = {
  checkedAt: "2026-05-12T00:00:00.000Z",
  cluster: {
    status: "not_ready",
    label: "Cluster not ready",
    detail: "Required local runtime dependencies are available.",
  },
  dependencies: [
    {
      id: "docker-daemon",
      label: "Docker daemon",
      status: "missing",
      required: true,
      description: "Docker daemon is not available to the dashboard runtime.",
      resolution: "Start Docker Desktop or the Docker Engine service, then retry once `docker ps` succeeds.",
    },
  ],
  providers: [],
};

const mockFetchResponses = (containers: unknown, readiness: unknown = mockReadiness) => {
  vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/onboarding/readiness")) {
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => readiness,
        text: async () => JSON.stringify(readiness),
      } as Response;
    }
    return {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => containers,
      text: async () => JSON.stringify(containers),
    } as Response;
  });
};

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
    expect(screen.getByRole("button", { name: /Docker Status: /i })).toBeInTheDocument();
  });

  it("announces a red critical runtime warning when readiness is not ready", async () => {
    mockFetchResponses([], mockNotReadyReadiness);

    render(<DockerStatusMenu />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("aria-live", "assertive");
    expect(alert).toHaveAttribute("aria-atomic", "true");
    expect(alert).toHaveTextContent("Runtime not ready");
    expect(alert.className).toContain("border-status-red");
    expect(alert.className).toContain("bg-status-red");
    expect(alert.className).toContain("text-status-red");
    expect(within(alert).getByText("!")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /runtime not ready/i })).toBeInTheDocument();
  });

  it("uses a motion-safe animated marker with a static exclamation fallback", async () => {
    mockFetchResponses([], mockNotReadyReadiness);

    render(<DockerStatusMenu />);

    await screen.findByRole("alert");
    const marker = screen.getByTestId("runtime-critical-marker");
    const glyph = screen.getByTestId("runtime-critical-glyph");

    expect(marker).toHaveAttribute("aria-hidden", "true");
    expect(glyph).toHaveTextContent("!");
    expect(glyph.className).toContain("motion-safe:animate-pulse");
    expect(glyph.className).toContain("motion-reduce:animate-none");
    expect(marker.querySelector(".motion-safe\\:animate-ping")).toBeInTheDocument();
  });

  it("does not render the critical warning when readiness is ready", async () => {
    mockFetchResponses([], mockReadiness);

    render(<DockerStatusMenu />);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalled();
    });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("Runtime not ready")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Docker Status: 0 active containers/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /runtime not ready/i })).not.toBeInTheDocument();
  });

  it("opens popover on click, displays containers, and traps focus", async () => {
    mockFetchResponses(mockContainers);

    render(<DockerStatusMenu />);

    expect(screen.queryByRole("dialog", { name: "Active Docker Containers" })).not.toBeInTheDocument();

    const button = screen.getByRole("button", { name: /Docker Status: /i });
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
    mockFetchResponses(mockContainers);

    render(<DockerStatusMenu />);
    const button = screen.getByRole("button", { name: /Docker Status: /i });
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
    mockFetchResponses(mockContainers);

    vi.useFakeTimers();

    const { container } = render(<DockerStatusMenu />);

    const wrapper = container.firstChild?.firstChild as HTMLElement;
    fireEvent.mouseEnter(wrapper);

    vi.runAllTimers();
    await Promise.resolve();

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Active Docker Containers" })).toBeInTheDocument();
    }, { timeout: 3000 });

    fireEvent.mouseLeave(wrapper);
    vi.runAllTimers();

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Active Docker Containers" })).not.toBeInTheDocument();
    }, { timeout: 3000 });

    vi.useRealTimers();
  });

  it("shows zero state when no containers exist", async () => {
    mockFetchResponses([]);

    render(<DockerStatusMenu />);
    const button = screen.getByRole("button", { name: /Docker Status: /i });
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
    const button = screen.getByRole("button", { name: /Docker Status: /i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText("No Containers")).toBeInTheDocument();
    });

    consoleSpy.mockRestore();
  });

  it("shows cluster-not-ready guidance when Docker is unavailable", async () => {
    mockFetchResponses([], mockNotReadyReadiness);

    render(<DockerStatusMenu />);
    fireEvent.click(screen.getByRole("button", { name: /Docker Status: /i }));

    await waitFor(() => {
      expect(screen.getByText("Runtime not ready")).toBeInTheDocument();
      expect(screen.getByText("Docker is mandatory")).toBeInTheDocument();
      expect(screen.getByText("Not Ready").className).toContain("text-status-red");
      expect(screen.getByText("missing").className).toContain("text-status-red");
      expect(screen.getByText(/Start Docker Desktop/)).toBeInTheDocument();
    });

    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });
});

void userEvent;
