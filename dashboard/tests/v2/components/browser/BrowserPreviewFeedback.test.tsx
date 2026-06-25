/** @vitest-environment happy-dom */
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@testing-library/preact";
import { expect, test, vi, afterEach } from "vitest";
import { LaunchContainerPanel } from "../../../../src/v2/components/browser/LaunchContainerPanel.js";
import { PreviewSessionSlider } from "../../../../src/v2/components/browser/PreviewSessionSlider.js";

afterEach(() => {
  cleanup();
});

test("LaunchContainerPanel shows correct status and feedback", () => {
  const { rerender } = render(
    <LaunchContainerPanel
      sprints={[]}
      launchSprintId=""
      onLaunchSprintChange={() => {}}
      onLaunchContainer={() => {}}
      launchEnabled={true}
      launchBusy={false}
    />
  );
  expect(screen.getByRole("button")).toHaveTextContent("No Sprints");
  expect(screen.getByRole("button")).toBeDisabled();

  rerender(
    <LaunchContainerPanel
      sprints={[{ id: "1", name: "Sprint 1", createdAt: "", updatedAt: "", projectId: "", tasks: [], status: "active" as any }]}
      launchSprintId="1"
      onLaunchSprintChange={() => {}}
      onLaunchContainer={() => {}}
      launchEnabled={false}
      launchBusy={false}
    />
  );
  expect(screen.getByRole("button")).toHaveTextContent("Unavailable");
  expect(screen.getByRole("button")).toBeDisabled();

  rerender(
    <LaunchContainerPanel
      sprints={[{ id: "1", name: "Sprint 1", createdAt: "", updatedAt: "", projectId: "", tasks: [], status: "active" as any }]}
      launchSprintId="1"
      onLaunchSprintChange={() => {}}
      onLaunchContainer={() => {}}
      launchEnabled={true}
      launchBusy={true}
    />
  );
  expect(screen.getByRole("button")).toHaveTextContent("Starting...");
  expect(screen.getByRole("button")).toBeDisabled();

  rerender(
    <LaunchContainerPanel
      sprints={[{ id: "1", name: "Sprint 1", createdAt: "", updatedAt: "", projectId: "", tasks: [], status: "active" as any }]}
      launchSprintId="1"
      onLaunchSprintChange={() => {}}
      onLaunchContainer={() => {}}
      launchEnabled={true}
      launchBusy={false}
    />
  );
  expect(screen.getByRole("button")).toHaveTextContent("Launch Container");
  expect(screen.getByRole("button")).not.toBeDisabled();
});

test("PreviewSessionSlider handles states correctly", () => {
  const mockSession = {
    id: "session1",
    sprintId: "1",
    sprintName: "Sprint 1",
    status: "starting" as const,
    healthStatus: "unknown" as const,
    containerAppPort: null,
    hostPort: null,
    startupScriptPath: null,
    lastKnownPath: "/",
    logs: [],
    createdAt: "",
    updatedAt: "",
  };

  render(
    <PreviewSessionSlider
      sessions={[mockSession]}
      selectedSessionId="session1"
      onSelectSession={() => {}}
      onRemoveSession={() => {}}
      removingSessionIds={[]}
    />
  );

  expect(screen.getByText("starting")).toBeInTheDocument();
  expect(screen.getByText("port pending")).toBeInTheDocument();
  expect(screen.getByText("waiting for routed port")).toBeInTheDocument();
});
