/** @vitest-environment happy-dom */
/** @jsx h */
import { h } from "preact";
import { cleanup, render as baseRender, screen, waitFor } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

expect.extend(matchers);

const sceneModuleState = vi.hoisted(() => ({
  loaded: false,
  reducedMotion: false,
}));

vi.mock("../../../dashboard/src/v2/hooks/use-reduced-motion.js", () => ({
  useReducedMotion: () => sceneModuleState.reducedMotion,
}));

vi.mock("../../../dashboard/src/v2/components/agents/AgentAvatarScene.js", () => {
  sceneModuleState.loaded = true;
  return {
    AgentAvatarScene: (props: { tool?: string | null }) => (
      <div data-testid="agent-avatar-scene" data-tool={props.tool ?? ""} />
    ),
  };
});

import { LazyAgentAvatarScene } from "../../../dashboard/src/v2/components/agents/LazyAgentAvatarScene.js";
import { DashboardI18nProvider } from "../../../dashboard/src/v2/i18n/index.js";

const render: typeof baseRender = (ui, options) => baseRender(ui, {
  ...options,
  wrapper: ({ children }) => (
    <DashboardI18nProvider initialLocale="en" storage={null}>
      {children}
    </DashboardI18nProvider>
  ),
});

type IntersectionHandler = IntersectionObserverCallback;

class DeferredIntersectionObserver {
  static instances: DeferredIntersectionObserver[] = [];

  readonly callback: IntersectionHandler;
  disconnect = vi.fn();
  observe = vi.fn();
  unobserve = vi.fn();
  takeRecords = vi.fn((): IntersectionObserverEntry[] => []);
  root = null;
  rootMargin = "0px";
  thresholds = [0];

  constructor(callback: IntersectionHandler) {
    this.callback = callback;
    DeferredIntersectionObserver.instances.push(this);
  }
}

class ImmediateIntersectionObserver extends DeferredIntersectionObserver {
  override observe = vi.fn((target: Element) => {
    this.callback([
      {
        isIntersecting: true,
        intersectionRatio: 1,
        target,
      } as IntersectionObserverEntry,
    ], this);
  });
}

describe("LazyAgentAvatarScene", () => {
  beforeEach(() => {
    sceneModuleState.loaded = false;
    sceneModuleState.reducedMotion = false;
    DeferredIntersectionObserver.instances = [];
    vi.clearAllMocks();
    window.IntersectionObserver = DeferredIntersectionObserver;
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders the static fallback without importing the 3D scene before visibility", async () => {
    render(<LazyAgentAvatarScene className="h-64 w-64" expression="happy" />);

    expect(screen.getByTestId("agent-avatar-fallback")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Agent avatar preview" })).toBeInTheDocument();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sceneModuleState.loaded).toBe(false);
    expect(screen.queryByTestId("agent-avatar-scene")).not.toBeInTheDocument();
  });

  it("keeps reduced-motion users on the static fallback without importing the 3D scene", async () => {
    sceneModuleState.reducedMotion = true;
    window.IntersectionObserver = ImmediateIntersectionObserver;

    render(<LazyAgentAvatarScene className="h-64 w-64" expression="bored" />);

    expect(screen.getByTestId("agent-avatar-fallback")).toBeInTheDocument();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sceneModuleState.loaded).toBe(false);
    expect(screen.queryByTestId("agent-avatar-scene")).not.toBeInTheDocument();
  });

  it("keeps the selected tool identifiable in the reduced-motion fallback", () => {
    sceneModuleState.reducedMotion = true;

    render(<LazyAgentAvatarScene eager tool="torch" expression="thinking" />);

    expect(screen.getByTestId("agent-avatar-fallback")).toHaveAttribute("data-tool", "torch");
    expect(screen.getByTestId("agent-avatar-static-tool")).toHaveTextContent("Welding torch");
    expect(screen.getByRole("img", { name: "Agent avatar preview working with Welding torch" })).toBeInTheDocument();
  });

  it("imports and renders the 3D scene once the avatar stage becomes visible", async () => {
    window.IntersectionObserver = ImmediateIntersectionObserver;

    render(<LazyAgentAvatarScene className="h-64 w-64" expression="happy" />);

    await waitFor(() => {
      expect(screen.getByTestId("agent-avatar-scene")).toBeInTheDocument();
    });
    expect(sceneModuleState.loaded).toBe(true);
  });

  it("passes the selected tool through to the visible 3D scene", async () => {
    window.IntersectionObserver = ImmediateIntersectionObserver;

    render(<LazyAgentAvatarScene tool="wrench" expression="happy" />);

    await waitFor(() => {
      expect(screen.getByTestId("agent-avatar-scene")).toHaveAttribute("data-tool", "wrench");
    });
  });

  it("disconnects the visibility observer when unmounted before visibility", () => {
    const { unmount } = render(<LazyAgentAvatarScene className="h-64 w-64" expression="happy" />);
    const [observer] = DeferredIntersectionObserver.instances;

    unmount();

    expect(observer?.disconnect).toHaveBeenCalled();
    expect(sceneModuleState.loaded).toBe(false);
  });
});
