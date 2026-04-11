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
vi.mock("../../../dashboard/src/v2/hooks/use-reduced-motion.js", () => ({
    useReducedMotion: () => false
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
        expect(screen.getByText("Awaiting runtime events...")).toBeInTheDocument();
    });
});
