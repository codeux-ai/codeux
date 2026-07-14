/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/preact";
import type { Source } from "../../../../../dashboard/src/v2/types.js";

const { selectProjectMock } = vi.hoisted(() => ({
  selectProjectMock: vi.fn(),
}));

let capturedCellActionsProps: Record<string, unknown> | null = null;

vi.mock("../../../../../dashboard/src/v2/context/project-data.js", () => ({
  useProjectData: vi.fn(() => ({
    selectProject: selectProjectMock,
  })),
}));

vi.mock("../../../../../dashboard/src/v2/components/ui/CellActions.js", () => ({
  CellActions: (props: Record<string, unknown>) => {
    capturedCellActionsProps = props;
    return <div data-testid="cell-actions" />;
  },
}));

vi.mock("gsap", () => ({
  default: {
    to: vi.fn(),
  },
}));

import { SourceCell } from "../../../../../dashboard/src/v2/components/ui/SourceCell.js";

describe("SourceCell", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    capturedCellActionsProps = null;
  });

  it("selects the project before handing off sprint and config navigation callbacks", () => {
    const source: Source = {
      id: "project-1",
      slug: "project-1",
      name: "Project 1",
      baseDir: "/workspace/project-1",
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
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    };

    render(<SourceCell source={source} isEven={true} />);

    expect(capturedCellActionsProps).not.toBeNull();
    expect(capturedCellActionsProps).toMatchObject({
      isRunning: false,
      to: "/sprints",
    });

    const { onSprintsClick, onSettingsClick } = capturedCellActionsProps as {
      onSprintsClick?: () => void | Promise<void>;
      onSettingsClick?: () => void | Promise<void>;
    };

    expect(typeof onSprintsClick).toBe("function");
    expect(typeof onSettingsClick).toBe("function");

    onSprintsClick?.();
    onSettingsClick?.();

    expect(selectProjectMock).toHaveBeenCalledTimes(2);
    expect(selectProjectMock).toHaveBeenNthCalledWith(1, "project-1");
    expect(selectProjectMock).toHaveBeenNthCalledWith(2, "project-1");
  });
});
