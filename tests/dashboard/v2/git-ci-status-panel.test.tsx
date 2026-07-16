/** @vitest-environment happy-dom */
import { h, Fragment } from "preact";
/** @jsx h */
/** @jsxFrag Fragment */
import { cleanup, render, screen } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { afterEach, describe, expect, it } from "vitest";

import { GitCIStatusPanel } from "../../../dashboard/src/v2/components/GitCIStatusPanel.js";
import { DashboardI18nProvider } from "../../../dashboard/src/v2/i18n/context.js";

expect.extend(matchers);

describe("GitCIStatusPanel localization", () => {
  afterEach(cleanup);

  it("localizes German panel chrome while preserving Git and CI payload values", () => {
    render(
      <DashboardI18nProvider initialLocale="de" storage={null}>
        <GitCIStatusPanel
          error={null}
          status={{
            branch: "feature/KEEP-branch-verbatim",
            dirty: true,
            mode: "REMOTE",
            tracking: { label: "origin/custom-runtime-label" },
            warnings: [
              "KEEP runtime Git warning verbatim",
              "KEEP warning 2",
              "KEEP warning 3",
              "KEEP warning 4",
              "KEEP warning 5",
              "KEEP warning 6",
              "KEEP warning 7",
            ],
            openPullRequests: [{
              number: 42,
              title: "KEEP PR title verbatim",
              url: "https://example.test/pr/42",
              headRefName: "feature/KEEP-head",
              baseRefName: "dev",
              mergeStateStatus: "BLOCKED_BY_POLICY",
              comments: 2,
            }],
            ciRuns: [{
              id: "ci-1",
              name: "KEEP CI name verbatim",
              workflowName: "KEEP workflow verbatim",
              url: "https://example.test/ci/1",
              status: "IN_PROGRESS_CUSTOM",
              conclusion: null,
            }],
            mergedPullRequests: [],
            lastUpdated: "2026-07-14T12:00:00.000Z",
          } as never}
        />
      </DashboardI18nProvider>,
    );

    expect(screen.getAllByText("Offene PRs").length).toBeGreaterThan(0);
    expect(screen.getByText("CI-Läufe")).toBeInTheDocument();
    expect(screen.getByText("Geändert")).toBeInTheDocument();
    expect(screen.getByText("feature/KEEP-branch-verbatim")).toBeInTheDocument();
    expect(screen.getByText("KEEP PR title verbatim")).toBeInTheDocument();
    expect(screen.getByText("KEEP workflow verbatim")).toBeInTheDocument();
    expect(screen.getByText("KEEP runtime Git warning verbatim")).toBeInTheDocument();
    expect(screen.getByText("2 weitere Warnungen werden ausgeblendet, damit dieser Bereich reaktionsschnell bleibt.")).toBeInTheDocument();
    expect(screen.queryByText("KEEP warning 6")).not.toBeInTheDocument();
    expect(screen.getByText(/BLOCKED BY POLICY/)).toBeInTheDocument();
    expect(screen.getByText("2 Kommentare")).toBeInTheDocument();
  });

  it("bounds unexpected warning floods to five details and one summary", () => {
    const warnings = Array.from({ length: 1_000 }, (_, index) => `Runtime warning ${index + 1}`);

    render(
      <DashboardI18nProvider initialLocale="en" storage={null}>
        <GitCIStatusPanel
          error={null}
          status={{
            branch: "feature/test",
            dirty: false,
            mode: "REMOTE",
            tracking: { label: "Feature PR CI" },
            warnings,
            openPullRequests: [],
            ciRuns: [],
            mergedPullRequests: [],
            lastUpdated: "2026-07-14T12:00:00.000Z",
          } as never}
        />
      </DashboardI18nProvider>,
    );

    const warningPanel = screen.getByText("Warnings").parentElement;
    expect(warningPanel).not.toBeNull();
    expect(warningPanel?.querySelectorAll("p")).toHaveLength(6);
    expect(screen.getByText("Runtime warning 1")).toBeInTheDocument();
    expect(screen.getByText("Runtime warning 5")).toBeInTheDocument();
    expect(screen.queryByText("Runtime warning 6")).not.toBeInTheDocument();
    expect(screen.queryByText("Runtime warning 1000")).not.toBeInTheDocument();
    expect(screen.getByText("995 additional warnings hidden to keep this panel responsive.")).toBeInTheDocument();
  });
});
