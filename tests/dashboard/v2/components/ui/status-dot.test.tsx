/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/preact";
import { StatusDot } from "../../../../../dashboard/src/v2/components/ui/StatusDot";

describe("StatusDot", () => {
  it("renders running state", () => {
    const { container } = render(<StatusDot status="running" />);
    expect(container.innerHTML).toContain("animate-ping");
  });

  it("renders failed state", () => {
    const { container } = render(<StatusDot status="failed" />);
    expect(container.innerHTML).toContain("bg-status-red");
  });

  it("renders intervention state", () => {
    const { container } = render(<StatusDot status="intervention" />);
    expect(container.innerHTML).toContain("bg-status-amber");
  });

  it("renders idle state", () => {
    const { container } = render(<StatusDot status="idle" />);
    expect(container.innerHTML).toContain("bg-slate-400");
  });
});
