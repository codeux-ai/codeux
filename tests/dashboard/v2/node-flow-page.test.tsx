/** @vitest-environment jsdom */
/** @jsx h */
import { h } from "preact";
import { cleanup, render, screen } from "@testing-library/preact";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NodesPage } from "../../../dashboard/src/v2/NodesPage.js";
import { ProjectDataContext } from "../../../dashboard/src/v2/context/project-data.js";
import { DashboardI18nProvider } from "../../../dashboard/src/v2/i18n/index.js";

vi.mock("../../../dashboard/src/v2/hooks/use-reduced-motion.js", () => ({ useReducedMotion: () => true, useResolvedMotionDuration: <T,>(value: T): T => value }));
vi.mock("../../../dashboard/src/v2/lib/motion/index.js", () => ({ useInteractionTokens: () => ({ controlFeedback: { duration: "0ms", ease: "linear" }, enterExit: { duration: "0ms", ease: "linear" }, selectionMovement: { duration: "0ms", ease: "linear" } }), useGsapInteractionTokens: () => ({ controlFeedback: { duration: 0, ease: "linear" }, enterExit: { duration: 0, ease: "linear" }, inlineValidation: { duration: 0, ease: "linear" }, selectionMovement: { duration: 0, ease: "linear" } }) }));

afterEach(cleanup);

describe("NodesPage project boundary", () => {
  it("requires a selected project before loading governed flows", () => {
    render(<DashboardI18nProvider storage={null}><ProjectDataContext.Provider value={{ projects: [], selectedProjectId: null, selectedProject: null, loading: false, error: null, refreshProjects: async () => undefined, selectProject: async () => undefined, createProject: async () => { throw new Error("unused"); }, updateProject: async () => { throw new Error("unused"); }, deleteProject: async () => undefined }}><NodesPage /></ProjectDataContext.Provider></DashboardI18nProvider>);
    expect(screen.getByRole("heading", { name: "Automation workspace" })).toBeInTheDocument();
    expect(screen.getByText("Select a project")).toBeInTheDocument();
    expect(screen.queryByText("Node catalog")).not.toBeInTheDocument();
  });
});
