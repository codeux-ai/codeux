/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, waitFor } from "@testing-library/preact";
import { h, Fragment } from "preact";
import { lazy, Suspense } from "preact/compat";

vi.mock("gsap", () => ({
  default: {
    fromTo: vi.fn(),
    to: vi.fn(),
  },
}));

vi.mock("../../../dashboard/src/v2/components/DockerStatusMenu.js", () => ({
  DockerStatusMenu: () => h("div", null, "DockerStatus")
}));

vi.mock("../../../dashboard/src/v2/components/browser/BrowserSessionsMenu.js", () => ({
  BrowserSessionsMenu: () => h("div", null, "BrowserSessions")
}));

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<any>("@tanstack/react-router");
  // Don't use external variables inside vi.mock factory, inline them or use strings
  const p = require("preact");
  const pc = require("preact/compat");
  return {
    ...actual,
    Link: pc.forwardRef((props: any, ref: any) => p.h("a", { href: props.to, ref, ...props }, props.children)),
    useRouterState: () => ({ matches: [] }),
    RouterProvider: ({ router }: any) => p.h("div", { "data-testid": "router" }),
  };
});

import { TopNav } from "../../../dashboard/src/v2/components/TopNav.js";
import { KineticDock } from "../../../dashboard/src/v2/components/KineticDock.js";
import { ProjectDataProvider } from "../../../dashboard/src/v2/context/project-data.js";

describe("Dashboard Main Shell", () => {
  beforeAll(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(query => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(), // deprecated
        removeListener: vi.fn(), // deprecated
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it("renders TopNav synchronously without waiting for three.js", () => {
    render(
      h(ProjectDataProvider, null,
        h(TopNav, { isDark: true, toggleTheme: () => {} })
      )
    );
    expect(screen.getByText(/Sprint/)).not.toBeNull();
  });

  it("renders KineticDock synchronously without waiting for three.js", () => {
    render(
      h(ProjectDataProvider, null,
        h(KineticDock, null)
      )
    );
    expect(screen.getByText("Chat")).not.toBeNull();
  });

  it("can lazy load DeepOceanBackground", async () => {
    const DeepOceanBackground = lazy(() => import("../../../dashboard/src/v2/components/chat/DeepOceanBackground.js").then(m => ({ default: m.DeepOceanBackground })));

    render(
      h(Suspense, { fallback: h("div", { "data-testid": "loading" }, "Loading...") },
        h(DeepOceanBackground, null)
      )
    );

    expect(screen.getByTestId("loading")).not.toBeNull();

    await waitFor(() => {
      const el = document.querySelector('div[aria-hidden="true"]');
      expect(el).not.toBeNull();
    });
  });
});
