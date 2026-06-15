/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/preact";
import * as matchers from '@testing-library/jest-dom/matchers';
import { expect, describe, it, vi } from "vitest";
import { ChatPageShell } from "../../../src/v2/components/chat/ChatPageShell.js";
import type { Source } from "../../../src/v2/types.js";

expect.extend(matchers);

// Mock GSAP to prevent animation issues in jsdom
vi.mock("gsap", () => ({
  default: {
    context: (cb: any) => {
      cb();
      return { revert: vi.fn() };
    },
    set: vi.fn(),
    fromTo: vi.fn(),
  },
}));

describe("ChatPageShell", () => {
  it("renders with flexible mobile stacking classes without fixed heights", () => {
    const mockProject: Source = {
      id: "proj-1",
      name: "Test Project",
      localPath: "/test",
      config: { active: true },
    } as unknown as Source;

    render(
      <ChatPageShell
        selectedProject={mockProject}
        chatMode="threads"
        onSetChatMode={() => {}}
        onRefresh={() => {}}
        manualRefreshing={false}
        onCreateThread={() => {}}
        pendingDashboardMessages={0}
        error={null}
        railSlot={<div data-testid="rail-slot">Rail</div>}
        detailSlot={<div data-testid="detail-slot">Detail</div>}
      />
    );

    // Ensure the main container does not use the fixed calc(100vh-48px) assumption anymore
    // It's the PageContainer which we passed className to
    const container = screen.getByText("Dashboard Chat").closest(".min-h-0");
    expect(container).toBeInTheDocument();

    // Verify grid stacks logically on mobile, breaking at lg
    const gridContainer = screen.getByTestId("rail-slot").parentElement;
    expect(gridContainer?.className).toContain("flex flex-col");
    expect(gridContainer?.className).toContain("lg:grid");

    // Check that we removed min-h-[70vh]
    expect(gridContainer?.className).not.toContain("min-h-[70vh]");
  });
});
