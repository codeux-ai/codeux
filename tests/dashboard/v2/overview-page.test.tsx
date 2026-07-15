/** @vitest-environment happy-dom */
import { cleanup, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { DashboardI18nProvider } from "../../../dashboard/src/v2/i18n/index.js";

expect.extend(matchers);

vi.mock("gsap", () => ({
  default: {
    context: (callback: () => void) => {
      callback();
      return { revert: vi.fn() };
    },
    set: vi.fn(),
    fromTo: vi.fn(),
  },
}));

vi.mock("../../../dashboard/src/v2/hooks/use-reduced-motion.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../dashboard/src/v2/hooks/use-reduced-motion.js")>(),
  useReducedMotion: () => true,
}));

vi.mock("../../../dashboard/src/v2/hooks/use-overview-page-data.js", () => ({
  useOverviewPageData: () => ({ projects: [], selectedProject: null, sprints: [], tasks: [], stats: null, execution: undefined, isLoading: false }),
}));

vi.mock("../../../dashboard/src/v2/components/HeaderStats.js", () => ({
  HeaderStats: () => <div>localized stats</div>,
}));

vi.mock("../../../dashboard/src/v2/components/SourcesGrid.js", () => ({
  SourcesGrid: () => <div>localized sources</div>,
}));

vi.mock("../../../dashboard/src/v2/components/TasksList.js", () => ({
  TasksList: () => <div>localized tasks</div>,
}));

vi.mock("../../../dashboard/src/v2/components/OverviewTelemetry.js", () => ({
  OverviewTelemetry: () => <div>localized telemetry</div>,
}));

import { DashboardV2 } from "../../../dashboard/src/v2/DashboardV2.js";

describe("Overview route localization", () => {
  afterEach(() => cleanup());

  it("renders German page copy, named landmarks, a polite route announcement, and responsive rail ordering", async () => {
    const { container } = render(
      <DashboardI18nProvider initialLocale="de" storage={null}>
        <DashboardV2 />
      </DashboardI18nProvider>,
    );

    expect(screen.getByRole("region", { name: "Dashboard-Übersicht" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Übersicht" })).toBeInTheDocument();
    expect(screen.getByText("Echtzeit-Kennzahlen und operative Einblicke für deinen gesamten Cluster.")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Status: Cluster optimal" })).toBeInTheDocument();
    expect(screen.getByText("Übersichtsseite geladen").closest('[role="status"]')).toHaveAttribute("aria-live", "polite");
    expect(screen.getByRole("region", { name: "Kennzahlen" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Quellen" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Aufgaben" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Live-Telemetrie" })).toHaveClass("order-last", "xl:order-none");
    expect(container.querySelector(".xl\\:grid-cols-12")).toBeInTheDocument();
    expect(await screen.findByText("localized telemetry")).toBeInTheDocument();
  });
});
