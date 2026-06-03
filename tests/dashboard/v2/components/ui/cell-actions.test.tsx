/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, cleanup } from "@testing-library/preact";
import { CellActions } from "../../../../../dashboard/src/v2/components/ui/CellActions.js";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, className, onClick, to, ...props }: any) => (
    <a
      href={to}
      className={className}
      onClick={(event) => {
        event.preventDefault();
        onClick?.(event);
      }}
      {...props}
    >
      {children}
    </a>
  ),
}));

describe("CellActions", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the Sprints action and stops bubbling while selecting the project routes", () => {
    const parentClick = vi.fn();
    const sprintsClick = vi.fn();
    const settingsClick = vi.fn();

    render(
      <div onClick={parentClick}>
        <CellActions
          isRunning={false}
          to="/sprints"
          onSprintsClick={sprintsClick}
          onSettingsClick={settingsClick}
        />
      </div>,
    );

    const sprintsLink = screen.getByRole("link", { name: /sprints/i });
    const settingsLink = screen.getByRole("link", { name: /settings/i });

    expect(sprintsLink.getAttribute("href")).toBe("/sprints");
    expect(settingsLink.getAttribute("href")).toBe("/config");

    fireEvent.click(sprintsLink);
    expect(sprintsClick).toHaveBeenCalledTimes(1);
    expect(parentClick).not.toHaveBeenCalled();

    fireEvent.click(settingsLink);
    expect(settingsClick).toHaveBeenCalledTimes(1);
    expect(parentClick).not.toHaveBeenCalled();
  });
});
