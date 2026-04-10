/** @vitest-environment jsdom */
import * as React from "preact/compat";
import { h } from "preact";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/preact";
import { Tooltip } from "../../../../dashboard/src/v2/components/ui/Tooltip.js";
import { InfoIconPopover } from "../../../../dashboard/src/v2/components/ui/InfoIconPopover.js";
import { CollapsiblePanel } from "../../../../dashboard/src/v2/components/ui/CollapsiblePanel.js";

describe("UI Interactions", () => {
    it("Tooltip supports keyboard parity", async () => {
        const { getByRole, queryByRole, getByText } = render(<Tooltip content="test tooltip"><button>Hover me</button></Tooltip>);
        const btn = getByText("Hover me");

        // Focus should open tooltip
        fireEvent.focus(btn);
        await waitFor(() => {
            expect(getByRole("tooltip")).toBeDefined();
        });

        // Escape should close tooltip
        fireEvent.keyDown(btn, { key: "Escape" });
        await waitFor(() => {
            expect(queryByRole("tooltip")).toBeNull();
        });
    });

    it("InfoIconPopover supports keyboard parity", async () => {
        const { getByRole, queryByRole, container } = render(<InfoIconPopover title="Info" items={[]} />);
        const popoverEl = container.querySelector(".cursor-help")!;

        // Focus should open
        fireEvent.focus(popoverEl);
        await waitFor(() => {
            expect(getByRole("tooltip")).toBeDefined();
        });

        // Escape should close
        fireEvent.keyDown(popoverEl, { key: "Escape" });
        await waitFor(() => {
            expect(queryByRole("tooltip")).toBeNull();
        });
    });

    it("CollapsiblePanel supports keyboard interactions", () => {
        const { getByText, container } = render(
            <CollapsiblePanel title="Test Panel" icon={() => <svg />} accentHex="#000">
                <div role="region">content</div>
            </CollapsiblePanel>
        );

        // Starts closed (assuming defaultOpen=false)
        expect(container.querySelector(".rotate-0")).toBeNull();

        const btn = container.querySelector("button")!;

        // Press Enter to open
        fireEvent.click(btn); // click triggers state change
        expect(container.querySelector(".rotate-0")).not.toBeNull();

        // Press Enter to close
        fireEvent.click(btn);
        expect(container.querySelector(".rotate-0")).toBeNull();
    });
});
