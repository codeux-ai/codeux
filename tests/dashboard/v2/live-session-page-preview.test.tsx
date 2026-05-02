/** @jsx h */
// @vitest-environment happy-dom
import { h } from "preact";
import { render, screen, cleanup } from "@testing-library/preact";
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }));
vi.mock("@tanstack/react-router", () => {
    return {
        Link: ({ children, to, ...props }: any) => (
            <a href={to} data-testid="router-link" {...(props as any)}>
                {children}
            </a>
        ),
        useNavigate: () => mockNavigate,
        useRouterState: () => ({ matches: [] }),
    };
});
import * as matchers from "@testing-library/jest-dom/matchers";
import { LivePreviewLink } from "../../../dashboard/src/v2/components/ui/LivePreviewLink.js";
import { SearchOverlay } from "../../../dashboard/src/v2/components/search/SearchOverlay.js";
import { CollapsiblePanel } from "../../../dashboard/src/v2/components/ui/CollapsiblePanel.js";
import { Search } from "lucide-preact";
import type { SprintPreviewSession } from "../../../dashboard/src/types.js";

expect.extend(matchers);

const makeSession = (overrides: Partial<SprintPreviewSession> = {}): SprintPreviewSession => ({
    id: "sess-1",
    projectId: "proj-1",
    sprintId: "sprint-1",
    status: "running",
    hostPort: 3000,
    lastKnownPath: "/",
    ...overrides,
} as SprintPreviewSession);

describe("LivePreviewLink CTA", () => {
    beforeEach(() => {
        cleanup();
    });

    it("does not render when session is null", () => {
        render(<LivePreviewLink session={null} />);
        expect(screen.queryByRole("link", { name: /Live Preview/i })).not.toBeInTheDocument();
    });

    it("does not render when session status is stopped", () => {
        render(<LivePreviewLink session={makeSession({ status: "stopped" })} />);
        expect(screen.queryByRole("link", { name: /Live Preview/i })).not.toBeInTheDocument();
    });

    it("does not render when session has no hostPort", () => {
        render(<LivePreviewLink session={makeSession({ hostPort: null as any })} />);
        expect(screen.queryByRole("link", { name: /Live Preview/i })).not.toBeInTheDocument();
    });

    it("renders preview link when session is running and has hostPort", () => {
        render(<LivePreviewLink session={makeSession({ lastKnownPath: "/test-path" })} />);
        const link = screen.getByRole("link", { name: /Live Preview/i });
        expect(link).toBeInTheDocument();
        expect(link.getAttribute("href")).toContain("/test-path");
        expect(link.getAttribute("href")).toContain("preview-sess-1");
    });

    it("does not render when session status is error", () => {
        render(<LivePreviewLink session={makeSession({ status: "error" })} />);
        expect(screen.queryByRole("link", { name: /Live Preview/i })).not.toBeInTheDocument();
    });
});

describe("Reduced Motion Support", () => {
    let originalMatchMedia: typeof window.matchMedia;

    beforeEach(() => {
        cleanup();
        originalMatchMedia = window.matchMedia;
        Object.defineProperty(window, 'matchMedia', {
            writable: true,
            value: vi.fn().mockImplementation(query => ({
                matches: query === '(prefers-reduced-motion: reduce)',
                media: query,
                onchange: null,
                addListener: vi.fn(),
                removeListener: vi.fn(),
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
                dispatchEvent: vi.fn(),
            })),
        });
        window.HTMLElement.prototype.scrollIntoView = vi.fn();
    });

    afterEach(() => {
        window.matchMedia = originalMatchMedia;
    });

    it("renders SearchOverlay cleanly under reduced motion", () => {
        const results = { sprints: [], tasks: [], agents: [], containers: [] };
        render(<SearchOverlay isOpen={true} onClose={() => {}} searchQuery="" onSearchChange={() => {}} results={results} />);

        expect(screen.getByPlaceholderText(/Search sprints, tasks, agents/i)).toBeInTheDocument();
        expect(screen.getByText(/Search SprintOS/i)).toBeInTheDocument();
    });

    it("renders CollapsiblePanel cleanly under reduced motion", () => {
        render(
            <CollapsiblePanel title="Test Panel" icon={Search} accentHex="#ff0000" defaultOpen={true}>
                <div>Panel Content</div>
            </CollapsiblePanel>
        );

        expect(screen.getByText("Test Panel")).toBeInTheDocument();
        expect(screen.getByText("Panel Content")).toBeInTheDocument();
    });
});
