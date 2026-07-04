// @vitest-environment jsdom
import { h } from "preact";
import { render, screen, waitFor, cleanup } from "@testing-library/preact";
import { afterEach, describe, expect, test, vi } from "vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { DropdownMenu, DropdownMenuItem } from "../DropdownMenu.js";

expect.extend(matchers);

vi.mock("gsap", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    default: {
      ...actual.default,
      killTweensOf: vi.fn(),
      fromTo: vi.fn(),
      to: vi.fn((target: any, vars: any) => vars?.onComplete?.()),
    },
  };
});

describe("DropdownMenu", () => {
  afterEach(() => {
    cleanup();
  });

  test("uses custom positioning and clamps the floating menu to the viewport", async () => {
    render(
      <DropdownMenu
        isOpen={true}
        onOpenChange={() => {}}
        menuAriaLabel="Actions"
        computePosition={() => ({ top: 24, left: 12, transformOrigin: "top left" })}
        content={<DropdownMenuItem>Archive sprint</DropdownMenuItem>}
      >
        <button type="button">Open actions</button>
      </DropdownMenu>
    );

    const menu = await screen.findByRole("menu", { name: "Actions" });
    await waitFor(() => expect(menu).toHaveStyle({ top: "24px", left: "12px", transformOrigin: "top left" }));
    expect(menu).toHaveClass("max-w-[calc(100vw-2rem)]");
  });
});
