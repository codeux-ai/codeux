/** @vitest-environment jsdom */
/** @jsx h */
/** @jsxFrag Fragment */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, Fragment } from "preact";
import { render, cleanup, fireEvent, screen, waitFor } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { BrowserSessionsMenu } from "../../../dashboard/src/v2/components/browser/BrowserSessionsMenu.js";

import { fetchPreviewSessions } from "../../../dashboard/src/v2/lib/browser-api.js";
// Mock dependencies
vi.mock("../../../dashboard/src/v2/context/project-data.js", () => ({
  useProjectData: () => ({
    selectedProject: { id: "test-project-123" }
  })
}));

vi.mock("../../../dashboard/src/v2/lib/browser-api.js", () => ({
  fetchPreviewSessions: vi.fn().mockResolvedValue([
    { id: "session-1", sprintName: "Sprint 1", status: "running", containerAppPort: 3000, hostPort: 8080 },
    { id: "session-2", sprintName: "Sprint 2", status: "stopped", containerAppPort: 3001, hostPort: null },
    { id: "session-3", sprintName: "Sprint 3", status: "error", containerAppPort: null, hostPort: null }
  ])
}));

vi.mock("../../../dashboard/src/v2/lib/preview-origin.js", () => ({
  buildPreviewUrl: () => "http://test-url"
}));

// Mock Link from router
vi.mock("@tanstack/react-router", () => ({
  Link: vi.fn().mockImplementation(
    ({ children, onClick, to, className, 'aria-label': ariaLabel, innerRef, ...rest }) => (
      <a href="javascript:void(0)" onClick={(e) => { e.preventDefault(); if(onClick) onClick(e); }} className={className} aria-label={ariaLabel} ref={(el) => {
        if (el && typeof el.focus !== "function") { el.focus = () => {}; }
        if (typeof innerRef === "function") innerRef(el);
        else if (innerRef) innerRef.current = el;
      }} {...rest}>{children}</a>
    )
  )
}));

expect.extend(matchers);

describe("BrowserSessionsMenu", () => {
  beforeEach(() => {
    cleanup();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should handle keyboard navigation correctly", async () => {
    render(<BrowserSessionsMenu />);

    const trigger = screen.getByText("Browser").closest('a');

    // Open with Click
    fireEvent.click(trigger);

    // Wait for async load to finish
    await waitFor(() => expect(screen.queryAllByRole("menuitem").length).toBe(3));

    // Check menu items
    const menuItems = await screen.findAllByRole("menuitem");
    expect(menuItems.length).toBe(3);

    // Arrow key navigation
    menuItems[0].focus();
    fireEvent.keyDown(trigger.parentElement, { key: "ArrowDown" });
    expect(document.activeElement).toBe(menuItems[1]);

    fireEvent.keyDown(trigger.parentElement, { key: "ArrowUp" });
    expect(document.activeElement).toBe(menuItems[0]);

    fireEvent.keyDown(trigger.parentElement, { key: "ArrowUp" });
    expect(document.activeElement).toBe(menuItems[2]);

    fireEvent.keyDown(trigger.parentElement, { key: "ArrowDown" });
    expect(document.activeElement).toBe(menuItems[0]);

    // Escape to close
    fireEvent.keyDown(trigger.parentElement, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("should handle blur", async () => {
    render(<BrowserSessionsMenu />);

    const trigger = screen.getByText("Browser").closest('a');

    // Open with click to test blur
    fireEvent.click(trigger);

    // Wait for async load to finish
    await waitFor(() => expect(screen.queryAllByRole("menuitem").length).toBe(3));

    fireEvent.blur(trigger.parentElement, { relatedTarget: document.body });

    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("should handle enter on parent", async () => {
    render(<BrowserSessionsMenu />);

    const trigger = screen.getByText("Browser").closest('a');

    // Open with enter
    fireEvent.keyDown(trigger.parentElement, { key: "Enter" });
    fireEvent.click(trigger);

    // Wait for async load to finish
    await waitFor(() => expect(screen.queryAllByRole("menuitem").length).toBe(3));

    fireEvent.blur(trigger.parentElement, { relatedTarget: document.body });

    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("should open on hover and close on unhover", async () => {
    vi.useFakeTimers();
    render(<BrowserSessionsMenu />);

    const trigger = screen.getByText("Browser").closest('a');

    fireEvent.mouseEnter(trigger.parentElement);

    await waitFor(() => expect(screen.queryAllByRole("menuitem").length).toBe(3));

    fireEvent.mouseLeave(trigger.parentElement);

    vi.runAllTimers();
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    vi.useRealTimers();
  });

  it("should handle key events with no menu items", async () => {
    vi.mocked(fetchPreviewSessions).mockResolvedValueOnce([]);

    render(<BrowserSessionsMenu />);
    const trigger = screen.getByText("Browser").closest('a');

    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByText("No active browser sessions.")).not.toBeNull());

    fireEvent.keyDown(trigger.parentElement, { key: "ArrowDown" });
    // Nothing should throw
  });
  it("should handle error in fetch", async () => {
    vi.mocked(fetchPreviewSessions).mockRejectedValueOnce(new Error("Failed"));
    render(<BrowserSessionsMenu />);
    const trigger = screen.getByText("Browser").closest('a');

    // Open
    fireEvent.click(trigger);

    // Wait for async load to finish, it should be caught and set sessions to []
    await waitFor(() => expect(screen.getByText("No active browser sessions.")).not.toBeNull());
  });
});
