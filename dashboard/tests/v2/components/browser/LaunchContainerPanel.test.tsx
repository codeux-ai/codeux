/** @vitest-environment happy-dom */
import "@testing-library/jest-dom/vitest";
import { render as testingRender, screen, cleanup } from "@testing-library/preact";
import { expect, test, vi, afterEach } from "vitest";
import { LaunchContainerPanel } from "../../../../src/v2/components/browser/LaunchContainerPanel.js";
import { DashboardI18nProvider } from "../../../../src/v2/i18n/context.js";

const render = (ui: Parameters<typeof testingRender>[0]) => testingRender(ui, {
  wrapper: ({ children }) => <DashboardI18nProvider initialLocale="en" storage={null}>{children}</DashboardI18nProvider>,
});

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
  const launchButton = screen.getByRole("button", { name: "Launch preview container" });
  expect(launchButton).toHaveTextContent("Disabled: No Sprint");
  expect(launchButton).toBeDisabled();
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
  const launchButton = screen.getByRole("button", { name: "Launch preview container" });
  expect(launchButton).toHaveTextContent("Disabled: No Project");
  expect(launchButton).toBeDisabled();
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
  const launchButton = screen.getByRole("button", { name: "Launching preview container" });
  expect(launchButton).toHaveTextContent("Launching...");
  expect(launchButton).toBeDisabled();
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
  const launchButton = screen.getByRole("button", { name: "Launch preview container" });
  expect(launchButton).toHaveTextContent("Launch Container");
  expect(launchButton).not.toBeDisabled();
});
