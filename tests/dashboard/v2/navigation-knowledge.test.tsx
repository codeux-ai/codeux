/**
 * @vitest-environment jsdom
 */
import { h } from "preact";
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { Sidebar } from "../../../dashboard/src/v2/components/layout/Sidebar.js";
import { PageContainer } from "../../../dashboard/src/v2/components/layout/PageContainer.js";
import { KineticDock } from "../../../dashboard/src/v2/components/KineticDock.js";
import { useRouterState } from "@tanstack/react-router";

expect.extend(matchers);

vi.mock("@tanstack/react-router", () => {
    const { forwardRef } = require("preact/compat");
    return {
        Link: forwardRef(({ children, to, className, 'data-tour-id': tourId, ...props }: any, ref: any) => (
            <a ref={ref} href={to} className={className} data-testid={`link-${to}`} data-tour-id={tourId} {...props}>
                {children}
            </a>
        )),
        useRouterState: vi.fn().mockReturnValue([{ pathname: "/" }]),
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
  useResolvedMotionDuration: (d: any) => d,
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
        vi.mocked(useRouterState).mockReturnValue([{ pathname: "/" }] as any);
    });

    it("renders Knowledge link in Sidebar", () => {
        render(<Sidebar />);
        const knowledgeLinks = screen.getAllByTestId("link-/knowledge");
        expect(knowledgeLinks[0]).toBeInTheDocument();
        expect(screen.getByText("Knowledge")).toBeInTheDocument();
    });

    it("keeps Sidebar navigation in the guided tour order", () => {
        render(<Sidebar />);

        const routeNames = screen.getAllByRole("link")
            .map((link) => link.getAttribute("aria-label") || link.textContent?.trim() || "")
            .filter((name) => [
                "Chat",
                "Overview",
                "Sprints",
                "Tasks",
                "Agents",
                "Nodes",
                "Dashboards",
                "Stats",
                "Schedule",
                "Memory",
                "Knowledge",
                "Browser Preview",
                "Files",
                "Live",
                "Docs",
                "Settings",
            ].includes(name));

        expect(routeNames).toEqual([
            "Chat",
            "Overview",
            "Sprints",
            "Tasks",
            "Agents",
            "Nodes",
            "Dashboards",
            "Stats",
            "Schedule",
            "Memory",
            "Knowledge",
            "Browser Preview",
            "Files",
            "Live",
            "Docs",
            "Settings",
        ]);
        expect(screen.getByRole("link", { name: "Schedule" })).toHaveAttribute("href", "/scheduler");
        expect(screen.getByRole("link", { name: "Knowledge" })).toHaveAttribute("href", "/knowledge");
        expect(screen.getByRole("link", { name: "Docs" })).toHaveAttribute("href", "/docs");
    });

    it("renders Knowledge link in KineticDock", () => {
        render(<KineticDock />);
        const knowledgeLinks = screen.getAllByTestId("link-/knowledge");
        expect(knowledgeLinks[knowledgeLinks.length - 1]).toBeInTheDocument();
        // The label might be in a tooltip/span
        expect(screen.getAllByText("Knowledge")[0]).toBeInTheDocument();
    });

    it("keeps KineticDock navigation in the guided tour order", () => {
        render(<KineticDock />);

        const routeNames = screen.getAllByRole("link")
            .map((link) => link.getAttribute("aria-label") || "")
            .filter(Boolean);

        expect(routeNames).toEqual([
            "Chat",
            "Overview",
            "Sprints",
            "Tasks",
            "Agents",
            "Nodes",
            "Dash",
            "Stats",
            "Schedule",
            "Memory",
            "Knowledge",
            "Browser",
            "Files",
            "Live",
            "Docs",
            "Config",
        ]);
        expect(screen.getByRole("link", { name: "Schedule" })).toHaveAttribute("href", "/scheduler");
        expect(screen.getByRole("link", { name: "Knowledge" })).toHaveAttribute("href", "/knowledge");
        expect(screen.getByRole("link", { name: "Docs" })).toHaveAttribute("href", "/docs");
    });

    it("gives dock links stable names and current-page semantics", () => {
        vi.mocked(useRouterState).mockReturnValue([{ pathname: "/knowledge" }] as any);

        render(<KineticDock />);

        const knowledgeLink = screen.getByRole("link", { name: "Knowledge" });
        expect(knowledgeLink).toHaveAttribute("aria-current", "page");
        expect(knowledgeLink).toHaveAttribute("data-active", "true");
        expect(screen.getByText("Active route: Knowledge")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Files" })).not.toHaveClass("text-violet-400");
        expect(screen.getByRole("link", { name: "Live" })).not.toHaveClass("text-status-red");
    });

    it("keeps mobile dock active state semantic for nested routes", () => {
        vi.mocked(useRouterState).mockReturnValue([{ pathname: "/sprints/active" }] as any);

        render(<KineticDock />);

        expect(screen.getByRole("link", { name: "Sprints" })).toHaveAttribute("aria-current", "page");
        expect(screen.getByRole("link", { name: "Sprints" })).toHaveAttribute("data-active", "true");
        expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute("data-active", "false");
    });

    it("keeps route containers named and focusable after navigation", () => {
        render(
            <PageContainer aria-label="Knowledge" padding="section">
                <h1>Knowledge</h1>
            </PageContainer>
        );

        const routeContainer = screen.getByRole("region", { name: "Knowledge" });
        expect(routeContainer).toHaveAttribute("data-focus-fallback");
        expect(routeContainer).toHaveAttribute("tabindex", "-1");
        expect(routeContainer).toHaveStyle({ animationDuration: "300ms" });

        routeContainer.focus();
        expect(routeContainer).toHaveFocus();
    });
});
