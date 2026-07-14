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
            warnings: ["KEEP runtime Git warning verbatim"],
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
    expect(screen.getByText(/BLOCKED BY POLICY/)).toBeInTheDocument();
    expect(screen.getByText("2 Kommentare")).toBeInTheDocument();
  });
});
