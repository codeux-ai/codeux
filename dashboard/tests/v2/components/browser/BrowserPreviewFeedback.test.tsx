/** @vitest-environment happy-dom */
import "@testing-library/jest-dom/vitest";
import { render as testingRender, screen, cleanup } from "@testing-library/preact";
import { expect, test, vi, afterEach } from "vitest";
import { LaunchContainerPanel } from "../../../../src/v2/components/browser/LaunchContainerPanel.js";
import { PreviewSessionSlider } from "../../../../src/v2/components/browser/PreviewSessionSlider.js";
import { DashboardI18nProvider } from "../../../../src/v2/i18n/context.js";

const render = (ui: Parameters<typeof testingRender>[0]) => testingRender(ui, {
  wrapper: ({ children }) => <DashboardI18nProvider initialLocale="en" storage={null}>{children}</DashboardI18nProvider>,
});

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
  expect(screen.getByRole("button", { name: "Launch preview container" })).toHaveTextContent("Disabled: No Sprint");
  expect(screen.getByRole("button", { name: "Launch preview container" })).toBeDisabled();

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
  expect(screen.getByRole("button", { name: "Launch preview container" })).toHaveTextContent("Disabled: No Project");
  expect(screen.getByRole("button", { name: "Launch preview container" })).toBeDisabled();

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
  expect(screen.getByRole("button", { name: "Launching preview container" })).toHaveTextContent("Launching...");
  expect(screen.getByRole("button", { name: "Launching preview container" })).toBeDisabled();

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
  expect(screen.getByRole("button", { name: "Launch preview container" })).toHaveTextContent("Launch Container");
  expect(screen.getByRole("button", { name: "Launch preview container" })).not.toBeDisabled();
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

  expect(screen.getByText("Starting")).toBeInTheDocument();
  expect(screen.getByText("port pending")).toBeInTheDocument();
  expect(screen.getByText("starting and waiting for routed port")).toBeInTheDocument();
});
