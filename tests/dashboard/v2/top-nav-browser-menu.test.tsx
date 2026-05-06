/** @jsx h */
// @vitest-environment happy-dom
import { h } from "preact";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/preact";
import { act } from "preact/test-utils";
import * as matchers from "@testing-library/jest-dom/matchers";
import { BrowserSessionsMenu } from "../../../dashboard/src/v2/components/browser/BrowserSessionsMenu.js";
import { useProjectData } from "../../../dashboard/src/v2/context/project-data.js";
import * as browserApi from "../../../dashboard/src/v2/lib/browser-api.js";
import { buildPreviewUrl } from "../../../dashboard/src/v2/lib/preview-origin.js";

expect.extend(matchers);

vi.mock("../../../dashboard/src/v2/context/project-data.js", () => ({


  useProjectData: vi.fn(),
}));

vi.mock("../../../dashboard/src/v2/lib/browser-api.js", () => ({
    fetchPreviewSessions: vi.fn(),
}));

vi.mock("../../../dashboard/src/v2/lib/preview-origin.js", () => ({
    buildPreviewUrl: vi.fn((sessionId, path) => `http://preview-${sessionId}.localhost${path || "/"}`),
}));

vi.mock("@tanstack/react-router", () => ({
    Link: ({ children, to, ...props }: any) => (
        <a href={to} data-testid="router-link" {...props}>
            {children}
        </a>
    ),
}));

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

        const button = screen.getByRole("button", { name: "Toggle active browser sessions" });
        expect(button).toBeInTheDocument();
    });

    it("shows polite empty state when no project is selected", async () => {
        vi.mocked(useProjectData).mockReturnValue({
            selectedProject: null,
        } as any);

        render(<BrowserSessionsMenu />);

        // Trigger click
        const button = screen.getByRole("button", { name: "Toggle active browser sessions" });
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
        const button = screen.getByRole("button", { name: "Toggle active browser sessions" });
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

        const button = screen.getByRole("button", { name: "Toggle active browser sessions" });
        fireEvent.click(button);

        await waitFor(() => {
            expect(screen.getByText("Add auth")).toBeInTheDocument();
            expect(screen.getByText("Update dashboard")).toBeInTheDocument();
        });

        // Check ports based on new format: `:${session.containerAppPort} ➔ :${session.hostPort}`
        expect(screen.getByText(/:3000 ➔ :8080/)).toBeInTheDocument();
        // Since session-2 doesn't have hostPort it shows pending port format
        expect(screen.getByText(/:5173 ➔ pending/)).toBeInTheDocument();

        // Check link generation
        const links = screen.getAllByRole("menuitem");
        expect(links).toHaveLength(2);

        expect(links[0]).toHaveAttribute("href", "http://preview-sess-1.localhost/login");
        expect(links[0]).toHaveAttribute("target", "_blank");

        expect(links[1]).toHaveAttribute("href", "http://preview-sess-2.localhost/");
        expect(links[1]).toHaveAttribute("target", "_blank");

        expect(browserApi.fetchPreviewSessions).toHaveBeenCalledWith("proj-1");
    });

    it("restores focus to trigger on escape and toggles aria-expanded", async () => {
        vi.useFakeTimers();

        vi.mocked(useProjectData).mockReturnValue({ selectedProject: null } as any);

        render(<BrowserSessionsMenu enabled={true} />);
        const button = screen.getByRole("button", { name: "Toggle active browser sessions" });

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
            const escapeEvent = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
            document.dispatchEvent(escapeEvent);
        });

        await waitFor(() => {
            expect(screen.queryByRole("menu")).toBeNull();
        });

        // Run setTimeout used for focus restoration
        await act(async () => {
            vi.runAllTimers();
        });

        vi.useRealTimers();

        expect(document.activeElement).toBe(button);
    });

    it("supports keyboard navigation with arrow keys", async () => {
        vi.mocked(useProjectData).mockReturnValue({
            selectedProject: { id: "proj-1" },
        } as any);

        const mockSessions = [
            { id: "sess-1", sprintId: "sprint-1", sprintName: "Add auth", status: "running", containerAppPort: 3000, hostPort: 8080 },
            { id: "sess-2", sprintId: "sprint-2", sprintName: "Update dashboard", status: "running", containerAppPort: 5173 }
        ];

        vi.mocked(browserApi.fetchPreviewSessions).mockResolvedValue(mockSessions as any);

        render(<BrowserSessionsMenu />);

        const button = screen.getByRole("button", { name: "Toggle active browser sessions" });

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

        // Arrow down to first item
        await act(async () => {
            fireEvent.keyDown(menu, { key: "ArrowDown" });
        });
        expect(document.activeElement).toBe(links[0]);

        // Arrow down to second item
        await act(async () => {
            fireEvent.keyDown(links[0], { key: "ArrowDown" });
        });
        expect(document.activeElement).toBe(links[1]);

        // Arrow down loops back to first item
        await act(async () => {
            fireEvent.keyDown(links[1], { key: "ArrowDown" });
        });
        expect(document.activeElement).toBe(links[0]);

        // Arrow up loops to last item
        await act(async () => {
            fireEvent.keyDown(links[0], { key: "ArrowUp" });
        });
        expect(document.activeElement).toBe(links[1]);
    });
});
