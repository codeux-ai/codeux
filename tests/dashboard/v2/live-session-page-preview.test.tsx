/** @jsx h */
// @vitest-environment jsdom
import { h } from "preact";
import { render, screen, cleanup } from "@testing-library/preact";
import { describe, it, expect, beforeEach } from "vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { LivePreviewLink } from "../../../dashboard/src/v2/components/ui/LivePreviewLink.js";
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
