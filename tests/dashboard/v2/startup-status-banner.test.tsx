/** @jsx h */
import { h } from "preact";
/**
 * @vitest-environment jsdom
 */
import { render } from "@testing-library/preact";
import { describe, expect, it } from "vitest";
import { StartupStatusBanner } from "../../../dashboard/src/v2/components/ui/StartupStatusBanner.js";
import type { RuntimeStartupStateSnapshot } from "../../../src/contracts/app-types.js";

describe("StartupStatusBanner", () => {
  it("renders nothing when startup is not provided", () => {
    const { container } = render(<StartupStatusBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when startup status is completed", () => {
    const startup: RuntimeStartupStateSnapshot = {
      status: "completed",
      jobs: [],
    };
    const { container } = render(<StartupStatusBanner startup={startup} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders info banner when jobs are pending/running", () => {
    const startup: RuntimeStartupStateSnapshot = {
      status: "running",
      jobs: [
        { name: "Recovery", status: "completed", error: null, startedAt: null, finishedAt: null, durationMs: null, retries: 0, detectedRunCommand: null },
        { name: "Aggregation", status: "running", error: null, startedAt: null, finishedAt: null, durationMs: null, retries: 0, detectedRunCommand: null },
      ],
    };
    const { container, getByText } = render(<StartupStatusBanner startup={startup} />);
    expect(container.firstChild).not.toBeNull();
    expect(getByText("Warming up")).toBeTruthy();
    expect(getByText("Aggregation")).toBeTruthy();
  });

  it("renders warning banner when startup is failed", () => {
    const startup: RuntimeStartupStateSnapshot = {
      status: "failed",
      jobs: [
        { name: "Recovery", status: "failed", error: "Connection refused", startedAt: null, finishedAt: null, durationMs: null, retries: 0, detectedRunCommand: null },
      ],
    };
    const { container, getByText } = render(<StartupStatusBanner startup={startup} />);
    expect(container.firstChild).not.toBeNull();
    expect(getByText("Startup Failed")).toBeTruthy();
    expect(getByText("Connection refused", { exact: false })).toBeTruthy();
  });
});
