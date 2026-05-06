/* eslint-disable */
import * as React from "preact/compat";
/**
 * @vitest-environment happy-dom
 */
import { h, Fragment } from "preact";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup, screen, waitFor } from "@testing-library/preact";
import { Tooltip } from "../../../dashboard/src/v2/components/ui/Tooltip.js";

describe("Tooltip", () => {
  afterEach(() => {
    cleanup();
  });

  it("opens on hover and closes on mouse leave", async () => {
    const { getByText, queryByRole } = render(
      <Tooltip content="Tooltip Content">
        <button>Trigger</button>
      </Tooltip>
    );

    const trigger = getByText("Trigger");
    expect(queryByRole("tooltip")).toBeNull();

    fireEvent.mouseEnter(trigger.parentElement!);

    await waitFor(() => {
        expect(screen.queryByRole("tooltip")).not.toBeNull();
    });

    fireEvent.mouseLeave(trigger.parentElement!);

    await waitFor(() => {
        expect(screen.queryByRole("tooltip")).toBeNull();
    });
  });

  it("opens on focus and closes on blur", async () => {
      const { getByText, queryByRole } = render(
          <Tooltip content="Tooltip Content">
            <button>Trigger</button>
          </Tooltip>
        );

        const trigger = getByText("Trigger");
        expect(queryByRole("tooltip")).toBeNull();

        // In happy-dom the target.matches(":focus-visible") might throw or fail, let's just make it focusable and dispatch FocusEvent directly
        Object.defineProperty(trigger.parentElement!, 'matches', { value: () => true });

        fireEvent.focus(trigger.parentElement!);

        await waitFor(() => {
            expect(screen.queryByRole("tooltip")).not.toBeNull();
        });

        fireEvent.blur(trigger.parentElement!);

        await waitFor(() => {
            expect(screen.queryByRole("tooltip")).toBeNull();
        });
  });

  it("closes on escape", async () => {
    const { getByText, queryByRole } = render(
        <Tooltip content="Tooltip Content">
          <button>Trigger</button>
        </Tooltip>
      );

      const trigger = getByText("Trigger");
      fireEvent.mouseEnter(trigger.parentElement!);

      await waitFor(() => {
          expect(screen.queryByRole("tooltip")).not.toBeNull();
      });

      fireEvent.keyDown(trigger.parentElement!, { key: "Escape" });

      await waitFor(() => {
        expect(screen.queryByRole("tooltip")).toBeNull();
      });
  });

});
