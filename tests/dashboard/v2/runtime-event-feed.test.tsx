import * as useReducedMotionModule from "../../../dashboard/src/v2/hooks/use-reduced-motion.js";
/** @vitest-environment happy-dom */
import { h, Fragment } from "preact";
/** @jsx h */
/** @jsxFrag Fragment */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
expect.extend(matchers);

import { RuntimeEventFeed } from "../../../dashboard/src/v2/components/RuntimeEventFeed.js";
import gsap from "gsap";

vi.mock("gsap", () => ({
    default: {
        fromTo: vi.fn()
    }
}));

describe("RuntimeEventFeed", () => {
    beforeEach(() => {
        cleanup();
        vi.clearAllMocks();
    });

    const mockEvents: any = [
        { id: "event-1", originator: "system", eventType: "test_event", createdAt: Date.now() }
    ];

    it("renders events and animates", () => {
        render(<RuntimeEventFeed events={mockEvents} />);

        expect(screen.getAllByText("test event").length).toBeGreaterThan(0);
        expect(gsap.fromTo).toHaveBeenCalled();
    });

    it("handles empty events", () => {
        render(<RuntimeEventFeed events={[]} />);
        expect(screen.getByText("No runtime events yet")).toBeInTheDocument();
    });

    it("animates only new elements on same-length replacement", () => {
        const { rerender } = render(<RuntimeEventFeed events={mockEvents} />);

        expect(gsap.fromTo).toHaveBeenCalledTimes(1);
        vi.mocked(gsap.fromTo).mockClear();

        const newEvents = [
            mockEvents[0],
            { id: "event-3", originator: "system", timestamp: Date.now(), title: "Another Event", content: "...", eventType: "test" }
        ];
        rerender(<RuntimeEventFeed events={newEvents as any} />);

        expect(gsap.fromTo).toHaveBeenCalledTimes(1);
    });

    it("bypasses animation when reduced motion is true", () => {
        vi.spyOn(useReducedMotionModule, 'useReducedMotion').mockReturnValue(true);
        render(<RuntimeEventFeed events={mockEvents} />);
        expect(screen.getAllByText("test event")[0]).toBeInTheDocument();
        expect(gsap.fromTo).not.toHaveBeenCalled();
        vi.spyOn(useReducedMotionModule, 'useReducedMotion').mockReturnValue(false); // reset
    });


    it("applies the flash background color during entry animation", () => {
        render(<RuntimeEventFeed events={mockEvents} />);
        expect(gsap.fromTo).toHaveBeenCalledWith(
            expect.any(Array),
            expect.objectContaining({ backgroundColor: 'rgba(0,224,160,0.1)' }),
            expect.objectContaining({ backgroundColor: 'transparent' })
        );
    });

    it("handles undefined events gracefully", () => {
        render(<RuntimeEventFeed events={undefined} />);
        expect(gsap.fromTo).not.toHaveBeenCalled();
    });

});
