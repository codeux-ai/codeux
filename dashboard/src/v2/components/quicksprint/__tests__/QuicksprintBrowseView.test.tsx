/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/preact";
import "@testing-library/jest-dom/vitest";

import type { QuicksprintTemplateRecord } from "../../../../../../src/contracts/quicksprint-types.js";
import { QuicksprintBrowseView } from "../QuicksprintBrowseView.js";

const makeTemplate = (id: string): QuicksprintTemplateRecord => ({
  id,
  projectId: null,
  name: `Template ${id}`,
  description: "A reusable quicksprint template.",
  icon: "Zap",
  category: "engineering",
  categoryColor: "ember",
  agentInstructionMarkdown: "Inspect the current repository and plan focused work.",
  defaultTaskCount: 5,
  isBuiltIn: true,
  purpose: "fullstack-js",
  purposeLabel: "Fullstack JS App",
  purposeDescription: "Default quicksprints for fullstack JavaScript applications.",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const templates = Array.from({ length: 5 }, (_, index) => makeTemplate(String(index + 1)));

function setElementScrollSize(element: HTMLElement, clientHeight: number, scrollHeight: number): void {
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    value: clientHeight,
  });
  Object.defineProperty(element, "scrollHeight", {
    configurable: true,
    value: scrollHeight,
  });
}

function renderBrowseView(selectedTemplateId: string | null = null): HTMLElement {
  const result = render(
    <div data-testid="scroll-host" style={{ overflowY: "auto" }}>
      <QuicksprintBrowseView
        templates={templates}
        builtinPurposeOptions={[{
          value: "fullstack-js",
          label: "Fullstack JS App",
          description: "Default quicksprints for fullstack JavaScript applications.",
        }]}
        selectedBuiltinPurpose="fullstack-js"
        setSelectedBuiltinPurpose={vi.fn()}
        handleSelectTemplate={vi.fn()}
        openEditor={vi.fn()}
        activeBuiltinPurpose={{
          value: "fullstack-js",
          label: "Fullstack JS App",
          description: "Default quicksprints for fullstack JavaScript applications.",
        }}
        loading={false}
        onClose={vi.fn()}
        selectedTemplateId={selectedTemplateId}
      />
    </div>,
  );

  return result.getByTestId("scroll-host");
}

describe("QuicksprintBrowseView", () => {
  afterEach(() => {
    cleanup();
  });

  it("forwards vertical wheel movement over template rails to the surrounding scroller", () => {
    const scrollHost = renderBrowseView();
    setElementScrollSize(scrollHost, 300, 1200);
    scrollHost.scrollTop = 100;

    const rail = screen.getByRole("region", { name: "quicksprint templates" });
    const event = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaY: 120,
    });

    const dispatchResult = rail.dispatchEvent(event);

    expect(dispatchResult).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    expect(scrollHost.scrollTop).toBe(220);
  });

  it("leaves horizontal wheel movement available for template rail scrolling", () => {
    const scrollHost = renderBrowseView();
    setElementScrollSize(scrollHost, 300, 1200);
    scrollHost.scrollTop = 100;

    const rail = screen.getByRole("region", { name: "quicksprint templates" });
    const event = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaX: 120,
      deltaY: 8,
    });

    const dispatchResult = rail.dispatchEvent(event);

    expect(dispatchResult).toBe(true);
    expect(event.defaultPrevented).toBe(false);
    expect(scrollHost.scrollTop).toBe(100);
  });

  it("marks the selected template with static context", () => {
    renderBrowseView("2");

    const selectedLaunch = screen.getByRole("button", { name: "Template 2" });
    expect(selectedLaunch).toHaveAttribute("aria-pressed", "true");
    expect(selectedLaunch.closest("article")).toHaveAttribute("aria-current", "true");

    expect(screen.getByRole("button", { name: "Template 1" })).not.toHaveAttribute("aria-pressed");
  });
});
