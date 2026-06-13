/**
 * @vitest-environment jsdom
 */
import { h } from "preact";
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { Sidebar } from "../../../dashboard/src/v2/components/layout/Sidebar.js";
import { KineticDock } from "../../../dashboard/src/v2/components/KineticDock.js";

expect.extend(matchers);

vi.mock("@tanstack/react-router", () => {
    const { forwardRef } = require("preact/compat");
    return {
        Link: forwardRef(({ children, to, className, 'data-tour-id': tourId, ...props }: any, ref: any) => (
            <a ref={ref} href={to} className={className} data-testid={`link-${to}`} data-tour-id={tourId} {...props}>
                {children}
            </a>
        )),
        useRouterState: vi.fn().mockReturnValue({ matches: [{ pathname: "/" }] }),
    };
});

vi.mock("../../../dashboard/src/v2/router/route-prefetch.js", () => ({
    prefetchRoute: vi.fn(),
}));

vi.mock("../../../dashboard/src/v2/context/project-data.js", () => ({
    useProjectData: vi.fn().mockReturnValue({ selectedProject: { id: "p1" } }),
}));

vi.mock("../../../dashboard/src/v2/hooks/use-project-effective-settings.js", () => ({
    useProjectEffectiveSettings: vi.fn().mockReturnValue({
        data: {
            settings: {
                sprintPreview: { enabled: true, showInAppBrowser: true },
            },
        },
    }),
}));

vi.mock("../../../dashboard/src/v2/hooks/use-reduced-motion.js", () => ({
    useReducedMotion: vi.fn().mockReturnValue(false),
}));

// Mock GSAP to avoid issues in JSDOM
vi.mock("gsap", () => {
    const gsapMock = {
        fromTo: vi.fn(),
        set: vi.fn(),
        to: vi.fn(),
        context: (cb: any) => { cb(); return { revert: vi.fn() }; },
        timeline: vi.fn(() => ({
            to: vi.fn().mockReturnThis(),
            fromTo: vi.fn().mockReturnThis(),
            set: vi.fn().mockReturnThis(),
            kill: vi.fn().mockReturnThis(),
        })),
        kill: vi.fn(),
    };
    return { default: gsapMock };
});

global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
};

describe("Knowledge Base Navigation", () => {
    afterEach(() => {
        cleanup();
    });

    it("renders Knowledge link in Sidebar", () => {
        render(<Sidebar />);
        const knowledgeLinks = screen.getAllByTestId("link-/knowledge");
        expect(knowledgeLinks[0]).toBeInTheDocument();
        expect(screen.getByText("Knowledge")).toBeInTheDocument();
    });

    it("renders Knowledge link in KineticDock", () => {
        render(<KineticDock />);
        const knowledgeLinks = screen.getAllByTestId("link-/knowledge");
        expect(knowledgeLinks[knowledgeLinks.length - 1]).toBeInTheDocument();
        // The label might be in a tooltip/span
        expect(screen.getAllByText("Knowledge")[0]).toBeInTheDocument();
    });
});
