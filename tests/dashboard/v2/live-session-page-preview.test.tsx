/** @jsx h */
// @vitest-environment happy-dom
import { h } from "preact";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/preact";
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { LivePreviewLink } from "../../../dashboard/src/v2/components/ui/LivePreviewLink.js";
import { SearchOverlay } from "../../../dashboard/src/v2/components/search/SearchOverlay.js";
vi.mock("@tanstack/react-router", async () => {
    return {
        useNavigate: () => vi.fn(),
        useRouterState: () => ({ matches: [] }),
        Link: ({ children, to }: any) => <a href={to}>{children}</a>,
    };
});
import { CollapsiblePanel } from "../../../dashboard/src/v2/components/ui/CollapsiblePanel.js";
import { Search } from "lucide-preact";
import type { SprintPreviewSession } from "../../../dashboard/src/types.js";

expect.extend(matchers);

const makeSession = (overrides: Partial<SprintPreviewSession> = {}): SprintPreviewSession => ({
    id: "sess-1",
    projectId: "proj-1",
    sprintId: "sprint-1",
    projectName: "Project 1",
    sprintName: "Sprint 1",
    sprintNumber: 1,
    status: "running",
    hostPort: 3000,
    containerAppPort: 5173,
    portMappings: [{ containerPort: 5173, hostPort: 3000, label: "App", isPrimary: true }],
    containerId: "container-1",
    containerName: "preview-container-1",
    worktreePath: null,
    featureBranch: "feature/live-preview",
    startupScriptPath: ".code-ux/browser/start-preview.sh",
    startupMode: "auto",
    installCommand: null,
    buildCommand: null,
    runCommand: null,
    lastCompletedTaskCount: 0,
    lastSeenSprintStatus: "running",
    lastKnownPath: "/",
    healthStatus: "healthy",
    lastError: null,
    lastBuildAt: null,
    lastStartedAt: null,
    lastStoppedAt: null,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
});

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

    it("keeps a single routed port as a one-click primary link without the port menu", () => {
        render(<LivePreviewLink session={makeSession()} />);

        const link = screen.getByRole("link", { name: /Live Preview/i });
        expect(link).toHaveAttribute("href", expect.stringContaining("preview-sess-1"));
        expect(screen.queryByRole("button", { name: /Choose Live Preview port/i })).not.toBeInTheDocument();
        expect(screen.queryByRole("listbox", { name: /Live Preview ports/i })).not.toBeInTheDocument();
    });

    it("opens and closes a compact multi-port listbox", async () => {
        render(
            <LivePreviewLink
                session={makeSession({
                    portMappings: [
                        { containerPort: 5173, hostPort: 3000, label: "App", isPrimary: true },
                        { containerPort: 6006, hostPort: 3001, label: "Storybook" },
                    ],
                })}
            />,
        );

        const trigger = screen.getByRole("button", { name: /Choose Live Preview port/i });
        fireEvent.click(trigger);

        expect(await screen.findByRole("listbox", { name: /Live Preview ports/i })).toBeInTheDocument();
        expect(screen.getByRole("option", { name: /Open Live Preview App on container port 5173/i })).toBeInTheDocument();
        expect(screen.getByRole("option", { name: /Open Live Preview Storybook on container port 6006/i })).toBeInTheDocument();

        fireEvent.click(trigger);
        await waitFor(() => {
            expect(screen.queryByRole("listbox", { name: /Live Preview ports/i })).not.toBeInTheDocument();
        });
    });

    it("opens a secondary routed port with the selected preview-port URL", async () => {
        render(
            <LivePreviewLink
                session={makeSession({
                    lastKnownPath: "/components?tab=preview",
                    portMappings: [
                        { containerPort: 5173, hostPort: 3000, label: "App", isPrimary: true },
                        { containerPort: 6006, hostPort: 3001, label: "Storybook" },
                    ],
                })}
            />,
        );

        fireEvent.click(screen.getByRole("button", { name: /Choose Live Preview port/i }));
        const secondary = await screen.findByRole("option", { name: /Open Live Preview Storybook on container port 6006/i });

        expect(secondary).toHaveAttribute("href", expect.stringContaining("/components?tab=preview&previewPort=6006"));
        expect(secondary).toHaveAttribute("href", expect.stringContaining("preview-sess-1"));
    });

    it("shows pending port options as disabled visible rows instead of links", async () => {
        render(
            <LivePreviewLink
                session={makeSession({
                    portMappings: [
                        { containerPort: 5173, hostPort: 3000, label: "App", isPrimary: true },
                        { containerPort: 6006, hostPort: null, label: "Storybook" },
                    ],
                })}
            />,
        );

        fireEvent.click(screen.getByRole("button", { name: /Choose Live Preview port/i }));
        const pending = await screen.findByRole("option", { name: /Storybook unavailable/i });

        expect(pending).toHaveAttribute("aria-disabled", "true");
        expect(pending.tagName.toLowerCase()).toBe("div");
        expect(pending).toHaveTextContent("waiting for a routed host port");
        expect(pending).toHaveTextContent(":6006 -> pending");
    });

    it("moves focus into routed options and restores it to the arrow on Escape", async () => {
        render(
            <LivePreviewLink
                session={makeSession({
                    portMappings: [
                        { containerPort: 5173, hostPort: 3000, label: "App", isPrimary: true },
                        { containerPort: 6006, hostPort: null, label: "Storybook" },
                        { containerPort: 7007, hostPort: 3002, label: "Docs" },
                    ],
                })}
            />,
        );

        const trigger = screen.getByRole("button", { name: /Choose Live Preview port/i });
        fireEvent.keyDown(trigger, { key: "ArrowDown" });

        const firstOption = await screen.findByRole("option", { name: /Open Live Preview App on container port 5173/i });
        await waitFor(() => expect(firstOption).toHaveFocus());

        const listbox = screen.getByRole("listbox", { name: /Live Preview ports/i });
        fireEvent.keyDown(listbox, { key: "ArrowDown" });
        expect(screen.getByRole("option", { name: /Open Live Preview Docs on container port 7007/i })).toHaveFocus();

        fireEvent.keyDown(listbox, { key: "Escape" });
        await waitFor(() => {
            expect(screen.queryByRole("listbox", { name: /Live Preview ports/i })).not.toBeInTheDocument();
            expect(trigger).toHaveFocus();
        });
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

        expect(screen.getByPlaceholderText(/Find sprints, tasks, agents/i)).toBeInTheDocument();
        expect(screen.getByText(/Quick navigation/i)).toBeInTheDocument();
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
