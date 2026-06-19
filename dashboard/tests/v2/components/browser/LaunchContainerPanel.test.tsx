/** @vitest-environment happy-dom */
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@testing-library/preact";
import { expect, test, vi, afterEach } from "vitest";
import { LaunchContainerPanel } from "../../../../src/v2/components/browser/LaunchContainerPanel.js";

afterEach(() => {
  cleanup();
});

test("renders No Sprints state", () => {
  render(
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
});

test("renders Unavailable state", () => {
  render(
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
});

test("renders Starting state", () => {
  render(
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
});

test("renders Launch Container state", () => {
  const onLaunch = vi.fn();
  render(
    <LaunchContainerPanel
      sprints={[{ id: "1", name: "Sprint 1", createdAt: "", updatedAt: "", projectId: "", tasks: [], status: "active" as any }]}
      launchSprintId="1"
      onLaunchSprintChange={() => {}}
      onLaunchContainer={onLaunch}
      launchEnabled={true}
      launchBusy={false}
    />
  );
  expect(screen.getByRole("button")).toHaveTextContent("Launch Container");
  expect(screen.getByRole("button")).not.toBeDisabled();
});
