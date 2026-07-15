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
import { DashboardI18nProvider } from "../../../dashboard/src/v2/i18n/context.js";
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
        const feed = screen.getByRole("log", { name: "Runtime feed" });
        expect(feed).toHaveAttribute("aria-live", "polite");
        expect(feed).toHaveAttribute("aria-relevant", "additions text");
        expect(feed).toHaveAttribute("aria-busy", "false");
        expect(screen.getByLabelText(/Runtime event: test event from System/i)).toBeInTheDocument();
        expect(gsap.fromTo).toHaveBeenCalled();
    });

    it("handles empty events", () => {
        render(<RuntimeEventFeed events={[]} />);
        expect(screen.getByText("No runtime events yet")).toBeInTheDocument();
        expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
        expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "false");
    });

    it("announces loading state before events are available", () => {
        render(<RuntimeEventFeed events={undefined} />);

        const status = screen.getByRole("status");
        expect(status).toHaveAttribute("aria-live", "polite");
        expect(status).toHaveAttribute("aria-busy", "true");
        expect(status).toHaveTextContent("Loading runtime events");
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
        expect(screen.getByRole("log", { name: "Runtime feed" })).toHaveAttribute("aria-busy", "false");
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
        expect(screen.getByRole("status")).toHaveTextContent("Runtime feed status remains available while activity loads.");
    });

    it("localizes German feed chrome without translating runtime-authored event content", () => {
        const event = {
            id: "event-verbatim",
            originator: "provider",
            eventType: "provider_activity",
            createdAt: "2026-07-14T12:34:00.000Z",
            payload: { description: "Provider says: keep THIS payload unchanged" },
        };
        render(
            <DashboardI18nProvider initialLocale="de" storage={null}>
                <RuntimeEventFeed events={[event] as any} />
            </DashboardI18nProvider>,
        );

        expect(screen.getByRole("log", { name: "Laufzeit-Feed" })).toBeInTheDocument();
        expect(screen.getByText("Provider says: keep THIS payload unchanged")).toBeInTheDocument();
        expect(screen.getByLabelText(/Laufzeitereignis: provider activity von Anbieter/)).toBeInTheDocument();
    });

});
