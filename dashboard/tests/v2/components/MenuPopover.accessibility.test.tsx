/** @vitest-environment jsdom */
import { h } from "preact";
import { render, screen, fireEvent, waitFor } from "@testing-library/preact";
import { Menu } from "../../../src/v2/components/ui/Menu";
import { Popover } from "../../../src/v2/components/ui/Popover";
import { DropdownMenu } from "../../../src/v2/components/ui/DropdownMenu";
import { describe, it, expect, vi } from "vitest";
import * as matchers from '@testing-library/jest-dom/matchers';

expect.extend(matchers);

// Mock GSAP to prevent animation issues in jsdom
vi.mock("gsap", () => {
  return {
    default: {
      killTweensOf: vi.fn(),
      fromTo: vi.fn(),
      to: vi.fn(),
    },
  };
});

describe("Menu and Popover Accessibility", () => {
  it("Menu renders trigger as a button by default and opens on Enter", async () => {
    let isOpen = false;
    const { rerender } = render(
      <Menu isOpen={isOpen} onOpenChange={(v) => { isOpen = v; rerender(<Menu isOpen={isOpen} onOpenChange={(v) => { isOpen = v; }}>MenuTrigger</Menu>); }}>MenuTrigger</Menu>
    );

    const trigger = screen.getByText("MenuTrigger");
    expect(trigger.tagName.toLowerCase()).toBe("button");
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");

    fireEvent.keyDown(trigger, { key: "Enter" });
    await waitFor(() => expect(isOpen).toBe(true));
  });

  it("Popover renders trigger as a button by default and opens on Space", async () => {
    let isOpen = false;
    const { rerender } = render(
      <Popover isOpen={isOpen} onOpenChange={(v) => { isOpen = v; rerender(<Popover isOpen={isOpen} onOpenChange={(v) => { isOpen = v; }} content={<div data-testid="content" />}>PopoverTrigger</Popover>); }} content={<div data-testid="content" />}>PopoverTrigger</Popover>
    );

    const trigger = screen.getByText("PopoverTrigger");
    expect(trigger.tagName.toLowerCase()).toBe("button");
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");

    fireEvent.keyDown(trigger, { key: " " });
    await waitFor(() => expect(isOpen).toBe(true));
  });

  it("DropdownMenu respects custom button child when asChild is true", async () => {
    let isOpen = false;
    const { rerender } = render(
      <DropdownMenu asChild isOpen={isOpen} onOpenChange={(v) => { isOpen = v; rerender(<DropdownMenu asChild isOpen={isOpen} onOpenChange={(v) => { isOpen = v; }}><button role="button">Custom Trigger</button></DropdownMenu>); }}>
        <button role="button">Custom Trigger</button>
      </DropdownMenu>
    );

    const trigger = screen.getByText("Custom Trigger");
    expect(trigger.tagName.toLowerCase()).toBe("button");
    const parent = trigger.parentElement;
    expect(parent?.tagName.toLowerCase()).not.toBe("button");
  });

  it("Menu restores focus to trigger on Escape", async () => {
    let isOpen = true;
    const { rerender } = render(
      <Menu isOpen={isOpen} onOpenChange={(v) => { isOpen = v; }}>
        TriggerEscape
      </Menu>
    );

    const trigger = screen.getByText("TriggerEscape");
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(isOpen).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it("Menu closes on outside click", async () => {
    let isOpen = true;
    const { rerender } = render(
      <div>
        <div data-testid="outside">Outside</div>
        <Menu isOpen={isOpen} onOpenChange={(v) => { isOpen = v; }}>
          TriggerOutside
        </Menu>
      </div>
    );

    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(isOpen).toBe(false);
  });

  it("Menu renders content in a portal when open", () => {
    const { baseElement } = render(
      <Menu isOpen={true} onOpenChange={() => {}} className={"my-menu-class"} content={<div data-testid="portal-content" />}>
        TriggerPortal
      </Menu>
    );

    const menu = baseElement.querySelector('[role="menu"]');
    expect(menu).toBeInTheDocument();
    expect(document.body.querySelector('[data-testid="portal-content"]')).toBeInTheDocument();
  });
});
