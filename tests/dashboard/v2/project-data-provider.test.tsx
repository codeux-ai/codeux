/** @jsx h */
/** @vitest-environment jsdom */
import { h } from "preact";
import { render, screen, act } from "@testing-library/preact";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ProjectDataProvider, useProjectData } from "../../../dashboard/src/v2/context/project-data";
import * as projectApi from "../../../dashboard/src/v2/lib/project-api";
import { useEffect } from "preact/hooks";
import type { Source } from "../../../dashboard/src/v2/types";
import type { ProjectCollectionResponse } from "../../../src/contracts/project-management-types";

// Mock the API client
vi.mock("../../../dashboard/src/v2/lib/project-api", () => ({
  fetchProjects: vi.fn(),
  selectProject: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
}));

const mockProject: Source = {
  id: "p1",
  slug: "project-1",
  name: "Project 1",
  baseDir: "/mock/p1",
  repoUrl: null,
  sourceType: "local",
  sourceRef: "main",
  defaultBranch: null,
  featureBranchPrefix: null,
  status: "idle",
  sprintsCount: 0,
  openTasks: 0,
  completedTasks: 0,
  isRunning: false,
  settingsOverrides: {},
  agentBindings: [],
  createdAt: "2023-01-01T00:00:00.000Z",
  updatedAt: "2023-01-01T00:00:00.000Z",
};

import { cleanup } from "@testing-library/preact";

describe("ProjectDataProvider", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const TestConsumer = ({ onRender }: { onRender?: (data: any) => void }) => {
    const data = useProjectData();
    if (onRender) {
      onRender(data);
    }
    return (
      <div>
        <div data-testid="selected-project-id">{data.selectedProjectId ?? "none"}</div>
        <div data-testid="project-count">{data.projects.length}</div>
        <div data-testid="loading">{String(data.loading)}</div>
        <div data-testid="error">{String(data.error)}</div>
        <button data-testid="select-btn" onClick={() => data.selectProject("p2")}>
          Select p2
        </button>
        <button data-testid="refresh-btn" onClick={() => data.refreshProjects()}>
          Refresh
        </button>
      </div>
    );
  };

  it("provides stable project data when refreshed with unchanged data", async () => {
    const initialResponse: ProjectCollectionResponse = {
      projects: [mockProject],
      selectedProjectId: "p1",
    };

    // Mock the hook to just return whatever we fetch if it wasn't already handled
    // Wait, the API client mock should be sufficient because useRealtimeResource calls it.
    // The issue was we only mocked resolved value once. We mock it forever.
    vi.mocked(projectApi.fetchProjects).mockResolvedValue(initialResponse);

    let renderCount = 0;
    let lastData: any = null;

    const handleRender = (data: any) => {
      renderCount++;
      lastData = data;
    };

    render(
      <ProjectDataProvider>
        <TestConsumer onRender={handleRender} />
      </ProjectDataProvider>
    );

    // Wait for the async effect to fetch data
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(screen.getByTestId("selected-project-id").textContent).toBe("p1");
    expect(screen.getByTestId("project-count").textContent).toBe("1");

    const renderCountAfterMount = renderCount;
    const projectArrayAfterMount = lastData.projects;

    // Trigger silent background refresh
    await act(async () => {
      screen.getByTestId("refresh-btn").click();
    });

    // We shouldn't trigger an extra render with a new array reference because the data is equal
    expect(renderCount).toBe(renderCountAfterMount);
    expect(lastData.projects).toBe(projectArrayAfterMount);
    expect(vi.mocked(projectApi.fetchProjects)).toHaveBeenCalledTimes(2);
  });

  it("updates state optimistically during selectProject", async () => {
    const initialResponse: ProjectCollectionResponse = {
      projects: [mockProject, { ...mockProject, id: "p2", slug: "p2" }],
      selectedProjectId: "p1",
    };

    vi.mocked(projectApi.fetchProjects).mockResolvedValueOnce(initialResponse);

    // Simulate a slow server response for select
    let resolveSelect: (val: string) => void;
    const selectPromise = new Promise<string>((resolve) => {
      resolveSelect = resolve;
    });
    vi.mocked(projectApi.selectProject).mockReturnValue(selectPromise);

    render(
      <ProjectDataProvider>
        <TestConsumer />
      </ProjectDataProvider>
    );

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(screen.getByTestId("selected-project-id").textContent).toBe("p1");

    // Trigger select
    act(() => {
      screen.getByTestId("select-btn").click();
    });

    // Should update optimistically to p2 immediately
    expect(screen.getByTestId("selected-project-id").textContent).toBe("p2");

    // Resolve the server call
    await act(async () => {
      resolveSelect!("p2");
    });

    expect(screen.getByTestId("selected-project-id").textContent).toBe("p2");
  });

  it("ignores aborted fetches during refresh", async () => {
    const initialResponse: ProjectCollectionResponse = {
      projects: [mockProject],
      selectedProjectId: "p1",
    };

    vi.mocked(projectApi.fetchProjects).mockResolvedValueOnce(initialResponse);

    render(
      <ProjectDataProvider>
        <TestConsumer />
      </ProjectDataProvider>
    );

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(screen.getByTestId("project-count").textContent).toBe("1");

    // The refresh will throw an AbortError
    vi.mocked(projectApi.fetchProjects).mockImplementationOnce(async (signal?: AbortSignal) => {
      const error = new Error("Aborted");
      error.name = "AbortError";
      throw error;
    });

    await act(async () => {
      screen.getByTestId("refresh-btn").click();
    });

    // Aborted refresh should not clear data or show an error
    expect(screen.getByTestId("project-count").textContent).toBe("1");
    expect(screen.getByTestId("error").textContent).toBe("null");
  });
});
