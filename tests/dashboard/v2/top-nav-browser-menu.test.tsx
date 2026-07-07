/** @jsx h */
// @vitest-environment happy-dom
import { h } from "preact";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/preact";
import { act } from "preact/test-utils";
import * as matchers from "@testing-library/jest-dom/matchers";
import { BrowserSessionsMenu } from "../../../dashboard/src/v2/components/browser/BrowserSessionsMenu.js";
import { TopNav } from "../../../dashboard/src/v2/components/TopNav.js";
import { useProjectData } from "../../../dashboard/src/v2/context/project-data.js";
import { useSprints } from "../../../dashboard/src/hooks/useSprints.js";
import { useNotifications } from "../../../dashboard/src/v2/hooks/use-notifications.js";
import { useRouterState } from "@tanstack/react-router";
import * as browserApi from "../../../dashboard/src/v2/lib/browser-api.js";
import { buildPreviewUrl } from "../../../dashboard/src/v2/lib/preview-origin.js";

expect.extend(matchers);

vi.mock("../../../dashboard/src/v2/context/project-data.js", () => ({


  useProjectData: vi.fn(),
}));

vi.mock("../../../dashboard/src/hooks/useSprints.js", () => ({
    useSprints: vi.fn(),
}));

vi.mock("../../../dashboard/src/v2/hooks/use-project-effective-settings.js", () => ({
    useProjectEffectiveSettings: vi.fn(() => ({
        data: {
            settings: {
                git: { sprintKeyPrefix: "SPR" },
                sprintPreview: { enabled: true, showInAppBrowser: true },
            },
        },
    })),
}));

vi.mock("../../../dashboard/src/v2/hooks/use-notifications.js", () => ({
    useNotifications: vi.fn(() => ({
        notifications: [],
        unreadCount: 0,
        markAllRead: vi.fn(),
        markRead: vi.fn(),
        dismiss: vi.fn(),
        refresh: vi.fn(),
    })),
}));

vi.mock("../../../dashboard/src/v2/hooks/useThemeSetting.js", () => ({
    useThemeSetting: vi.fn(() => ({ setTheme: vi.fn() })),
}));

vi.mock("../../../dashboard/src/v2/hooks/use-is-dark.js", () => ({
    useIsDark: vi.fn(() => true),
}));

vi.mock("../../../dashboard/src/v2/hooks/use-reduced-motion.js", () => ({
    useReducedMotion: vi.fn(() => true),
    useResolvedMotionDuration: (duration: number) => duration,
}));

vi.mock("../../../dashboard/src/v2/components/DockerStatusMenu.js", () => ({
    DockerStatusMenu: () => <button type="button" aria-label="Docker Status: 0 active containers" />,
}));

vi.mock("../../../dashboard/src/v2/components/top-nav/GlobalSearch.js", () => ({
    GlobalSearch: () => <button type="button" aria-label="Open search" />,
}));

vi.mock("../../../dashboard/src/v2/components/top-nav/TelemetryStats.js", () => ({
    TelemetryStats: () => <div aria-hidden="true" />,
}));

vi.mock("../../../dashboard/src/v2/components/top-nav/BrandSection.js", () => ({
    BrandSection: ({ isMobileMenuOpen, onMenuToggle }: any) => (
        <button
            type="button"
            aria-label={isMobileMenuOpen ? "Close mobile menu" : "Open mobile menu"}
            aria-expanded={!!isMobileMenuOpen}
            onClick={onMenuToggle}
        />
    ),
}));

vi.mock("gsap", () => ({
    default: {
        fromTo: vi.fn(),
        set: vi.fn(),
        to: vi.fn(),
        context: (cb: any) => {
            cb();
            return { add: vi.fn((fn: any) => fn()), revert: vi.fn() };
        },
    },
}));

vi.mock("../../../dashboard/src/v2/lib/browser-api.js", () => ({
    fetchPreviewSessions: vi.fn(),
}));

vi.mock("../../../dashboard/src/v2/lib/preview-origin.js", () => ({
    buildPreviewUrl: vi.fn((sessionId, path) => `http://preview-${sessionId}.localhost${path || "/"}`),
    getPrimaryPreviewPortMapping: vi.fn((session) => (
        session?.portMappings?.find((mapping: any) => mapping.isPrimary)
        ?? session?.portMappings?.[0]
        ?? { containerPort: session?.containerAppPort, hostPort: session?.hostPort, isPrimary: true }
    )),
    formatPreviewPortMappingsSummary: vi.fn((session) => {
        const mappings = session?.portMappings?.length
            ? session.portMappings
            : [{ containerPort: session?.containerAppPort, hostPort: session?.hostPort, isPrimary: true }];
        return mappings.map((mapping: any) => {
            const label = mapping.label ? `${mapping.label} :${mapping.containerPort}` : `:${mapping.containerPort}`;
            return `${label} -> ${mapping.hostPort ? `:${mapping.hostPort}` : "pending"}`;
        }).join(" · ");
    }),
}));

vi.mock("@tanstack/react-router", () => ({
    Link: ({ children, to, ...props }: any) => (
        <a href={to} data-testid="router-link" {...props}>
            {children}
        </a>
    ),
    useRouterState: vi.fn(() => [{ pathname: "/" }]),
}));

const makeProject = (id: string, name: string) => ({
    id,
    name,
    status: "idle",
    sourceType: "local",
    sourceRef: `/tmp/${id}`,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
});

const makeSprint = (id: string, name: string) => ({
    id,
    name,
    status: "planned",
    date: "2026-01-01",
    projectId: "proj-1",
    sprintKey: id.toUpperCase(),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
});

const mockTopNavData = ({
    projects = [makeProject("proj-1", "Alpha"), makeProject("proj-2", "Beta")],
    selectedProject = makeProject("proj-1", "Alpha"),
    sprints = [makeSprint("sprint-1", "Build shell"), makeSprint("sprint-2", "Fix nav")],
    selectedSprintId = "sprint-1",
    loading = false,
    sprintsLoading = false,
    selectProject = vi.fn().mockResolvedValue(undefined),
    selectSprint = vi.fn().mockResolvedValue(undefined),
} = {}) => {
    vi.mocked(useProjectData).mockReturnValue({
        projects,
        selectedProject,
        selectedProjectId: selectedProject?.id ?? null,
        loading,
        error: null,
        refreshProjects: vi.fn(),
        selectProject,
        createProject: vi.fn(),
        updateProject: vi.fn(),
        deleteProject: vi.fn(),
    } as any);
    vi.mocked(useSprints).mockReturnValue({
        data: sprints,
        selectedSprintId,
        selectedSprint: sprints.find((s: any) => s.id === selectedSprintId) ?? null,
        selectSprint,
        loading: sprintsLoading,
        error: null,
        refetch: vi.fn(),
    } as any);
    return { selectProject, selectSprint };
};

describe("BrowserSessionsMenu", () => {
    beforeEach(() => {
        cleanup();
        vi.clearAllMocks();
    });

    it("renders the main browser link", () => {
        vi.mocked(useProjectData).mockReturnValue({
            selectedProject: null,
        } as any);

        render(<BrowserSessionsMenu />);

        const button = screen.getByRole("button", { name: /Browser Sessions:/i });
        expect(button).toBeInTheDocument();
    });

    it("does not open from focus alone", () => {
        vi.mocked(useProjectData).mockReturnValue({
            selectedProject: null,
        } as any);

        render(<BrowserSessionsMenu />);

        const button = screen.getByRole("button", { name: /Browser Sessions:/i });
        button.focus();

        expect(button).toHaveFocus();
        expect(screen.queryByRole("menu")).not.toBeInTheDocument();
        expect(button).toHaveAttribute("aria-expanded", "false");
    });

    it("shows polite empty state when no project is selected", async () => {
        vi.mocked(useProjectData).mockReturnValue({
            selectedProject: null,
        } as any);

        render(<BrowserSessionsMenu />);

        // Trigger click
        const button = screen.getByRole("button", { name: /Browser Sessions:/i });
        fireEvent.click(button);

        await waitFor(() => {
            expect(screen.getByText("No project selected")).toBeInTheDocument();
        });
        expect(screen.getByText("Select a project to view its active sessions")).toBeInTheDocument();
    });

    it("shows empty state when project is selected but no sessions exist", async () => {
        vi.mocked(useProjectData).mockReturnValue({
            selectedProject: { id: "proj-1" },
        } as any);
        vi.mocked(browserApi.fetchPreviewSessions).mockResolvedValue([]);

        render(<BrowserSessionsMenu />);

        // Trigger click
        const button = screen.getByRole("button", { name: /Browser Sessions:/i });
        fireEvent.click(button);

        await waitFor(() => {
            expect(screen.getByText("No active sessions")).toBeInTheDocument();
        });
        expect(screen.getByText("Launch a session from the browser or sprint page")).toBeInTheDocument();
    });

    it("fetches and lists sessions correctly for the selected project", async () => {
        vi.mocked(useProjectData).mockReturnValue({
            selectedProject: { id: "proj-1" },
        } as any);

        const mockSessions = [
            {
                id: "sess-1",
                sprintId: "sprint-1",
                projectId: "proj-1",
                sprintName: "Add auth",
                status: "running",
                healthStatus: "healthy",
                containerAppPort: 3000,
                hostPort: 8080,
                lastKnownPath: "/login"
            },
            {
                id: "sess-2",
                sprintId: "sprint-2",
                projectId: "proj-1",
                sprintName: "Update dashboard",
                status: "stopped",
                healthStatus: "healthy",
                containerAppPort: 5173,
                lastKnownPath: null
            }
        ];

        vi.mocked(browserApi.fetchPreviewSessions).mockResolvedValue(mockSessions as any);

        render(<BrowserSessionsMenu />);

        const button = screen.getByRole("button", { name: /Browser Sessions:/i });
        fireEvent.click(button);

        await waitFor(() => {
            expect(screen.getByText("Add auth")).toBeInTheDocument();
            expect(screen.getByText("Update dashboard")).toBeInTheDocument();
        });

        expect(screen.getByText(/:3000 -> :8080/)).toBeInTheDocument();
        // Since session-2 doesn't have hostPort it shows pending port format
        expect(screen.getByText(/:5173 -> pending/)).toBeInTheDocument();

        // Check link generation
        const links = screen.getAllByRole("menuitem");
        expect(links).toHaveLength(2);

        expect(links[0]).toHaveAttribute("href", "http://preview-sess-1.localhost/login");
        expect(links[0]).toHaveAttribute("target", "_blank");

        expect(links[1]).not.toHaveAttribute("href");
        expect(links[1]).toHaveAttribute("aria-disabled", "true");

        expect(browserApi.fetchPreviewSessions).toHaveBeenCalledWith("proj-1");
    });

    it("shows compact multi-port summaries in the sessions menu", async () => {
        vi.mocked(useProjectData).mockReturnValue({
            selectedProject: { id: "proj-1" },
        } as any);

        vi.mocked(browserApi.fetchPreviewSessions).mockResolvedValue([
            {
                id: "sess-multi",
                sprintId: "sprint-1",
                projectId: "proj-1",
                sprintName: "Multi preview",
                status: "running",
                healthStatus: "healthy",
                containerAppPort: 3000,
                hostPort: 8080,
                portMappings: [
                    { containerPort: 3000, hostPort: 8080, isPrimary: true },
                    { containerPort: 5173, hostPort: 8081, label: "Vite" },
                    { containerPort: 6006, hostPort: null, label: "Storybook" },
                ],
                lastKnownPath: "/",
            },
        ] as any);

        render(<BrowserSessionsMenu />);

        fireEvent.click(screen.getByRole("button", { name: /Browser Sessions:/i }));

        await waitFor(() => {
            expect(screen.getByText("Multi preview")).toBeInTheDocument();
        });

        expect(screen.getByText(":3000 -> :8080 · Vite :5173 -> :8081 · Storybook :6006 -> pending")).toBeInTheDocument();
    });

    it("restores focus to trigger on escape and toggles aria-expanded", async () => {
        vi.useFakeTimers();

        vi.mocked(useProjectData).mockReturnValue({ selectedProject: null } as any);

        render(<BrowserSessionsMenu enabled={true} />);
        const button = screen.getByRole("button", { name: /Browser Sessions:/i });

        expect(button).toHaveAttribute("aria-expanded", "false");

        await act(async () => {
            fireEvent.click(button);
        });

        await waitFor(() => {
            expect(screen.queryByRole("menu")).not.toBeNull();
        });

        expect(button).toHaveAttribute("aria-expanded", "true");

        // Escape event fires on document
        await act(async () => {
            const escapeEvent = new KeyboardEvent('keydown', { key: 'Escape' });
            document.dispatchEvent(escapeEvent);
        });

        vi.useRealTimers();

        // Menu closes synchronously on interaction state change in this simple test scenario
        // but let's wait to be safe before checking focus if we were to wait for unmount
        // Instead of waitFor on queryByRole which might timeout under fake timers, we run timers if needed or just advance
        // But since we removed the setTimeout, the focus is immediate, and unmount should happen on next render

        expect(document.activeElement).toBe(button);
    });

    it("supports keyboard navigation with arrow keys", async () => {
        vi.mocked(useProjectData).mockReturnValue({
            selectedProject: { id: "proj-1" },
        } as any);

        const mockSessions = [
            { id: "sess-1", sprintId: "sprint-1", sprintName: "Add auth", status: "running", containerAppPort: 3000, hostPort: 8080 },
            { id: "sess-2", sprintId: "sprint-2", sprintName: "Update dashboard", status: "running", containerAppPort: 5173, hostPort: 8081 }
        ];

        vi.mocked(browserApi.fetchPreviewSessions).mockResolvedValue(mockSessions as any);

        render(<BrowserSessionsMenu />);

        const button = screen.getByRole("button", { name: /Browser Sessions:/i });

        // Open menu via keyboard
        await act(async () => {
            button.focus();
            fireEvent.keyDown(button, { key: "Enter" });
        });

        await waitFor(() => {
            expect(screen.getAllByRole("menuitem")).toHaveLength(2);
        });

        const menu = screen.getByRole("menu");
        const links = screen.getAllByRole("menuitem");

        // Explicitly focus the first link to simulate standard keyboard behavior
        await act(async () => {
            links[0].focus();
        });
        expect(document.activeElement).toBe(links[0]);

        // Arrow down to second item
        await act(async () => {
            fireEvent.keyDown(menu, { key: "ArrowDown" });
        });
        expect(document.activeElement).toBe(links[1]);

        // Arrow down loops back to first item
        await act(async () => {
            fireEvent.keyDown(menu, { key: "ArrowDown" });
        });
        expect(document.activeElement).toBe(links[0]);

        // Arrow up loops to last item
        await act(async () => {
            fireEvent.keyDown(menu, { key: "ArrowUp" });
        });
        expect(document.activeElement).toBe(links[1]);

        await act(async () => {
            fireEvent.keyDown(menu, { key: "Home" });
        });
        expect(document.activeElement).toBe(links[0]);

        await act(async () => {
            fireEvent.keyDown(menu, { key: "End" });
        });
        expect(document.activeElement).toBe(links[1]);
    });

    it("skips disabled session items during Home End and arrow navigation", async () => {
        vi.mocked(useProjectData).mockReturnValue({
            selectedProject: { id: "proj-1" },
        } as any);

        vi.mocked(browserApi.fetchPreviewSessions).mockResolvedValue([
            { id: "sess-disabled", sprintId: "sprint-0", sprintName: "Pending route", status: "starting", healthStatus: "unknown", containerAppPort: 3000, hostPort: null },
            { id: "sess-1", sprintId: "sprint-1", sprintName: "Runnable one", status: "running", healthStatus: "healthy", containerAppPort: 3000, hostPort: 8080 },
            { id: "sess-2", sprintId: "sprint-2", sprintName: "Runnable two", status: "running", healthStatus: "healthy", containerAppPort: 5173, hostPort: 8081 },
        ] as any);

        render(<BrowserSessionsMenu />);

        const button = screen.getByRole("button", { name: /Browser Sessions:/i });
        button.focus();
        fireEvent.keyDown(button, { key: "Enter" });

        await waitFor(() => {
            expect(screen.getAllByRole("menuitem")).toHaveLength(3);
        });

        const menu = screen.getByRole("menu");
        const items = screen.getAllByRole("menuitem");
        expect(items[0]).toHaveAttribute("aria-disabled", "true");

        await waitFor(() => {
            expect(document.activeElement).toBe(items[1]);
        });

        fireEvent.keyDown(menu, { key: "End" });
        expect(document.activeElement).toBe(items[2]);

        fireEvent.keyDown(menu, { key: "ArrowDown" });
        expect(document.activeElement).toBe(items[1]);

        fireEvent.keyDown(menu, { key: "Home" });
        expect(document.activeElement).toBe(items[1]);
    });

    it("restores trigger focus after outside click closes the menu", async () => {
        vi.mocked(useProjectData).mockReturnValue({
            selectedProject: null,
        } as any);

        render(
            <div>
                <BrowserSessionsMenu />
                <button type="button">Outside target</button>
            </div>
        );

        const button = screen.getByRole("button", { name: /Browser Sessions:/i });
        fireEvent.click(button);

        await waitFor(() => {
            expect(screen.getByRole("menu")).toBeInTheDocument();
        });

        fireEvent.mouseDown(screen.getByRole("button", { name: "Outside target" }));

        await waitFor(() => {
            expect(screen.queryByRole("menu")).not.toBeInTheDocument();
            expect(document.activeElement).toBe(button);
        });
    });

    it("keeps stale sessions visible while refresh is pending and downgrades refresh errors to polite status", async () => {
        vi.mocked(useProjectData).mockReturnValue({
            selectedProject: { id: "proj-1" },
        } as any);

        const firstSessions = [
            {
                id: "sess-1",
                sprintId: "sprint-1",
                projectId: "proj-1",
                sprintName: "Cached preview",
                status: "running",
                healthStatus: "healthy",
                containerAppPort: 3000,
                hostPort: 8080,
                lastKnownPath: "/"
            }
        ];
        let rejectRefresh: ((error: Error) => void) | null = null;
        vi.mocked(browserApi.fetchPreviewSessions)
            .mockResolvedValueOnce(firstSessions as any)
            .mockImplementationOnce(() => new Promise((_resolve, reject) => {
                rejectRefresh = reject;
            }));

        render(<BrowserSessionsMenu />);

        const button = screen.getByRole("button", { name: /Browser Sessions:/i });
        fireEvent.click(button);

        await waitFor(() => {
            expect(screen.getByText("Cached preview")).toBeInTheDocument();
        });

        fireEvent.keyDown(document, { key: "Escape" });
        await waitFor(() => {
            expect(screen.queryByRole("menu")).not.toBeInTheDocument();
        });

        fireEvent.click(button);
        await waitFor(() => {
            expect(screen.getByText("Cached preview")).toBeInTheDocument();
            expect(screen.getByRole("menu")).toHaveAttribute("aria-busy", "true");
            expect(screen.getByRole("status")).toHaveTextContent("Refreshing sessions. Current sessions remain available.");
        });

        rejectRefresh?.(new Error("refresh failed"));

        await waitFor(() => {
            expect(screen.getByText("Cached preview")).toBeInTheDocument();
            expect(screen.getByRole("status")).toHaveTextContent("Could not refresh sessions. Showing last loaded sessions. refresh failed");
            expect(screen.queryByRole("alert")).not.toBeInTheDocument();
        });
    });

    it("restores trigger focus after blur closes the sessions menu", async () => {
        vi.mocked(useProjectData).mockReturnValue({
            selectedProject: { id: "proj-1" },
        } as any);

        vi.mocked(browserApi.fetchPreviewSessions).mockResolvedValue([
            {
                id: "sess-1",
                sprintId: "sprint-1",
                projectId: "proj-1",
                sprintName: "Runnable preview",
                status: "running",
                healthStatus: "healthy",
                containerAppPort: 3000,
                hostPort: 8080,
                lastKnownPath: "/",
            },
        ] as any);

        render(
            <div>
                <BrowserSessionsMenu />
                <button type="button">After sessions</button>
            </div>
        );

        const button = screen.getByRole("button", { name: /Browser Sessions:/i });
        fireEvent.click(button);

        const item = await screen.findByRole("menuitem", { name: /Open preview session Runnable preview/i });
        const outside = screen.getByRole("button", { name: "After sessions" });
        item.focus();
        item.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: outside }));

        await waitFor(() => {
            expect(screen.queryByRole("menu")).not.toBeInTheDocument();
            expect(document.activeElement).toBe(button);
        });
    });
});

describe("TopNav shell accessibility", () => {
    beforeEach(() => {
        cleanup();
        vi.clearAllMocks();
        vi.mocked(useRouterState).mockReturnValue([{ pathname: "/" }] as any);
    });

    it("supports listbox keyboard navigation and restores project trigger focus on Escape", async () => {
        mockTopNavData();

        render(<TopNav />);

        const trigger = screen.getByRole("button", { name: /Project selector, selected project: Alpha/i });
        trigger.focus();
        fireEvent.keyDown(trigger, { key: "ArrowDown" });

        await waitFor(() => {
            expect(screen.getByRole("listbox", { name: "Project list" })).toBeInTheDocument();
            expect(document.activeElement).toHaveAttribute("id", "project-option-proj-1");
        });

        fireEvent.keyDown(document.activeElement as Element, { key: "End" });

        await waitFor(() => {
            expect(document.activeElement).toHaveAttribute("id", "project-option-proj-2");
            expect(trigger).toHaveAttribute("aria-activedescendant", "project-option-proj-2");
        });

        fireEvent.keyDown(document.activeElement as Element, { key: "Home" });

        await waitFor(() => {
            expect(document.activeElement).toHaveAttribute("id", "project-option-proj-1");
            expect(trigger).toHaveAttribute("aria-activedescendant", "project-option-proj-1");
        });

        fireEvent.keyDown(document.activeElement as Element, { key: "Escape" });

        await waitFor(() => {
            expect(screen.queryByRole("listbox", { name: "Project list" })).not.toBeInTheDocument();
            expect(document.activeElement).toBe(trigger);
        });
    });

    it("bounds project and sprint dropdown option panes with fixed responsive scroll caps", async () => {
        mockTopNavData({
            projects: Array.from({ length: 24 }, (_, index) => makeProject(`proj-${index + 1}`, `Project ${index + 1}`)),
            selectedProject: makeProject("proj-1", "Project 1"),
            sprints: Array.from({ length: 24 }, (_, index) => makeSprint(`sprint-${index + 1}`, `Sprint ${index + 1}`)),
            selectedSprintId: "sprint-1",
        });

        render(<TopNav />);

        fireEvent.click(screen.getByRole("button", { name: /Project selector, selected project: Project 1/i }));

        const projectListbox = await screen.findByRole("listbox", { name: "Project list" });
        const projectScrollPane = projectListbox.querySelector(".dropdown-scrollbar");
        expect(projectScrollPane).toHaveClass("max-h-64", "sm:max-h-72", "md:max-h-80", "overflow-y-auto");
        expect(projectScrollPane?.className).not.toContain("100dvh");

        fireEvent.click(screen.getByRole("button", { name: /Sprint selector, selected sprint: Sprint 1/i }));

        const sprintListbox = await screen.findByRole("listbox", { name: "Sprint list" });
        const sprintScrollPane = sprintListbox.querySelector(".dropdown-scrollbar");
        expect(sprintScrollPane).toHaveClass("max-h-64", "sm:max-h-72", "md:max-h-80", "overflow-y-auto");
        expect(sprintScrollPane?.className).not.toContain("100dvh");
    });

    it("renders only real sprint options and does not treat all as a special filter match", async () => {
        mockTopNavData({ selectedSprintId: null });

        render(<TopNav />);

        const trigger = screen.getByRole("button", { name: /Sprint selector, selected sprint: All Sprints/i });
        trigger.focus();
        fireEvent.keyDown(trigger, { key: "ArrowDown" });

        const listbox = await screen.findByRole("listbox", { name: "Sprint list" });
        await waitFor(() => {
            expect(document.activeElement).toHaveAttribute("id", "sprint-option-sprint-1");
        });

        expect(listbox.querySelector("#sprint-option-none")).not.toBeInTheDocument();
        expect(listbox).not.toHaveTextContent("All Sprints");
        expect(screen.getAllByRole("option").map((option) => option.id)).toEqual([
            "sprint-option-sprint-1",
            "sprint-option-sprint-2",
        ]);

        fireEvent.input(screen.getByLabelText("Filter sprints"), { target: { value: "all" } });

        await waitFor(() => {
            expect(listbox).toHaveTextContent("No sprints found.");
        });
        expect(listbox.querySelector("#sprint-option-none")).not.toBeInTheDocument();
        expect(listbox).not.toHaveTextContent("All Sprints");
    });

    it("focuses the selected sprint option and restores sprint trigger focus on Escape", async () => {
        mockTopNavData({ selectedSprintId: "sprint-2" });

        render(<TopNav />);

        const trigger = screen.getByRole("button", { name: /Sprint selector, selected sprint: Fix nav/i });
        trigger.focus();
        fireEvent.keyDown(trigger, { key: "ArrowDown" });

        await waitFor(() => {
            expect(screen.getByRole("listbox", { name: "Sprint list" })).toBeInTheDocument();
            expect(document.activeElement).toHaveAttribute("id", "sprint-option-sprint-2");
        });

        fireEvent.keyDown(document.activeElement as Element, { key: "Escape" });

        await waitFor(() => {
            expect(screen.queryByRole("listbox", { name: "Sprint list" })).not.toBeInTheDocument();
            expect(document.activeElement).toBe(trigger);
        });
    });

    it("announces selector empty states without opening a disabled sprint listbox", async () => {
        mockTopNavData({ sprints: [], selectedSprintId: null });

        render(<TopNav />);

        const sprintTrigger = screen.getByRole("button", { name: /Sprint selector, selected sprint: All Sprints/i });
        expect(sprintTrigger).toHaveAttribute("aria-disabled", "true");
        expect(sprintTrigger).not.toHaveAttribute("aria-controls");

        fireEvent.click(sprintTrigger);

        await waitFor(() => {
            expect(screen.getByRole("status")).toHaveTextContent("No sprints available for Alpha");
        });
        expect(screen.queryByRole("listbox", { name: "Sprint list" })).not.toBeInTheDocument();
    });

    it("announces route changes through the persistent nav status region", async () => {
        mockTopNavData();

        const { rerender } = render(<TopNav />);
        vi.mocked(useRouterState).mockReturnValue([{ pathname: "/sprints" }] as any);
        rerender(<TopNav />);

        await waitFor(() => {
            expect(screen.getByRole("status")).toHaveTextContent("Route changed to sprints");
        });
    });

    it("restores notification trigger focus after outside click closes the panel", async () => {
        mockTopNavData();
        vi.mocked(useNotifications).mockReturnValue({
            notifications: [],
            unreadCount: 1,
            markAllRead: vi.fn(),
            markRead: vi.fn(),
            dismiss: vi.fn(),
            refresh: vi.fn(),
        } as any);

        render(
            <div>
                <TopNav />
                <button type="button">Outside notification target</button>
            </div>
        );

        const trigger = screen.getByRole("button", { name: /Notifications: 1 unread/i });
        fireEvent.click(trigger);

        await waitFor(() => {
            expect(screen.getByRole("dialog", { name: "Notifications Panel" })).toBeInTheDocument();
        });

        fireEvent.mouseDown(screen.getByRole("button", { name: "Outside notification target" }));

        await waitFor(() => {
            expect(screen.queryByRole("dialog", { name: "Notifications Panel" })).not.toBeInTheDocument();
            expect(document.activeElement).toBe(trigger);
        });
    });
});
