/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/preact";
import { StatusDot } from "../../../../../dashboard/src/v2/components/ui/StatusDot";
import * as matchers from '@testing-library/jest-dom/matchers';
expect.extend(matchers);

describe("StatusDot", () => {
  it("renders accessible label and respects reduced motion", () => {
    const { container } = render(<StatusDot status="running" />);
    expect(screen.getByRole("img", { name: "Status: running" })).toBeInTheDocument();
    expect(container.innerHTML).toContain("motion-reduce:animate-none");
    expect(container.innerHTML).toContain("motion-reduce:ring-[color:var(--status-static-running-aura)]");
  });

  it("renders running state", () => {
    const { container } = render(<StatusDot status="running" />);
    expect(container.innerHTML).toContain("animate-ping");
    expect(container.innerHTML).toContain("shadow-[0_0_10px_var(--status-static-running-ring)]");
  });

  it("renders failed state", () => {
    const { container } = render(<StatusDot status="failed" />);
    expect(container.innerHTML).toContain("bg-status-red");
    expect(container.innerHTML).toContain("status-static-failed-ring");
  });

  it("renders intervention state", () => {
    const { container } = render(<StatusDot status="intervention" />);
    expect(container.innerHTML).toContain("bg-status-amber");
    expect(container.innerHTML).toContain("status-static-intervention-aura");
  });

  it("renders idle state", () => {
    const { container } = render(<StatusDot status="idle" />);
    expect(container.innerHTML).toContain("bg-[var(--text-metadata)]");
  });
});
