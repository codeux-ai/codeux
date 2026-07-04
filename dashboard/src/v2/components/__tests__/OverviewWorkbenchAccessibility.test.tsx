// @vitest-environment jsdom
import { expect, test, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";

import { HeaderStats } from "../HeaderStats.js";
import { SourcesGrid } from "../SourcesGrid.js";
import { OverviewTelemetry } from "../OverviewTelemetry.js";
import { useOverviewTelemetry } from "../../../hooks/use-overview-telemetry.js";
import { useProjectData } from "../../context/project-data.js";

expect.extend(matchers);

vi.mock("gsap", () => ({
  default: {
    context: vi.fn((callback: () => void) => {
      callback();
      return { revert: vi.fn() };
    }),
    fromTo: vi.fn(),
    set: vi.fn(),
    to: vi.fn(),
    timeline: vi.fn(() => ({ to: vi.fn().mockReturnThis() })),
  },
}));

vi.mock("../../hooks/use-reduced-motion.js", () => ({
  useReducedMotion: () => true,
}));

vi.mock("../../../hooks/use-overview-telemetry.js", () => ({
  useOverviewTelemetry: vi.fn(),
}));

vi.mock("../../context/project-data.js", () => ({
  useProjectData: vi.fn(),
}));

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.mocked(useProjectData).mockReturnValue({
    projects: [],
    loading: false,
    selectProject: vi.fn(),
  } as any);
});

test("overview metrics expose a named loading status region", () => {
  render(
    <HeaderStats
      pageData={{
        projects: [],
        selectedProject: null,
        sprints: [],
        tasks: [],
        stats: null,
        isLoading: true,
      } as any}
    />,
  );

  expect(screen.getByRole("status", { name: "Loading overview metrics" })).toBeInTheDocument();
});

test("project sources expose the shared empty state as a polite status", () => {
  render(<SourcesGrid />);

  expect(screen.getByRole("status")).toHaveTextContent("No Project Sources");
  expect(screen.getByText("Project sources appear here after a repository is connected.")).toBeInTheDocument();
});

test("live telemetry exposes loading and empty states as named status regions", () => {
  vi.mocked(useOverviewTelemetry).mockReturnValue({
    telemetry: {
      activeProjects: [],
      attentionProjects: [],
      recentEvents: [],
      updatedAt: null,
    },
    loading: true,
    error: null,
    refresh: vi.fn(),
  } as any);

  const { rerender } = render(<OverviewTelemetry />);
  expect(screen.getByRole("status", { name: "Loading live telemetry" })).toBeInTheDocument();

  vi.mocked(useOverviewTelemetry).mockReturnValue({
    telemetry: {
      activeProjects: [],
      attentionProjects: [],
      recentEvents: [],
      updatedAt: null,
    },
    loading: false,
    error: null,
    refresh: vi.fn(),
  } as any);

  rerender(<OverviewTelemetry />);
  expect(screen.getByRole("status", { name: "No active runtime telemetry" })).toHaveTextContent("Awaiting Runtime");
  expect(screen.getByText("No active project telemetry yet")).toBeInTheDocument();
});
