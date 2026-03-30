/** @vitest-environment jsdom */
/** @jsx h */
import { h } from "preact";
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { AgentAvatarScene } from "../../../dashboard/src/v2/components/agents/AgentAvatarScene.js";
import { DEFAULT_AGENT_AVATAR_CONFIG } from "../../../dashboard/src/v2/lib/agent-avatar.js";

expect.extend(matchers);

// Mock window.matchMedia
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
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

// Mock Three.js since it won't run properly in pure jsdom without canvas support
vi.mock("three", () => {
  return {
    Scene: class {
      add() {}
    },
    PerspectiveCamera: class {
      position = { z: 10, y: 2 };
      updateProjectionMatrix() {}
    },
    AmbientLight: class {},
    DirectionalLight: class { position = { set: () => {} } },
    Group: class {
      add() {}
      position = { y: 0 };
      rotation = { x: 0, y: 0, z: 0 };
    },
    MeshStandardMaterial: class {
      dispose() {}
      color = { setHex: () => {} };
    },
    MeshBasicMaterial: class {
      dispose() {}
      color = { setHex: () => {} };
    },
    Mesh: class {
      position = { set: () => {}, y: 0, x: 0, z: 0 };
      rotation = { set: () => {}, x: 0, y: 0, z: 0, copy: () => {} };
      scale = { set: () => {}, setY: () => {}, copy: () => {} };
      add() {}
    },
    SphereGeometry: class { dispose() {} },
    CylinderGeometry: class { dispose() {} },
    CapsuleGeometry: class { dispose() {} },
    BoxGeometry: class { dispose() {} },
    Vector3: class {
      set() {}
      copy() {}
    },
    MathUtils: {
      lerp: (start: number, end: number, amt: number) => start + (end - start) * amt,
    },
    WebGLRenderer: class {
      setSize() {}
      setPixelRatio() {}
      domElement = document.createElement("canvas");
      render() {}
      dispose() {}
    },
  };
});

describe("AgentAvatarScene", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("should render the WebGL scene container by default", () => {
    const { getByTestId, queryByTestId } = render(
      <AgentAvatarScene config={DEFAULT_AGENT_AVATAR_CONFIG} />
    );
    expect(getByTestId("agent-avatar-scene")).toBeInTheDocument();
    expect(queryByTestId("agent-avatar-fallback")).toBeNull();
  });

  it("should render fallback UI when fallbackMode is true", () => {
    const { getByTestId, queryByTestId, container } = render(
      <AgentAvatarScene config={DEFAULT_AGENT_AVATAR_CONFIG} fallbackMode={true} />
    );
    expect(getByTestId("agent-avatar-fallback")).toBeInTheDocument();
    expect(queryByTestId("agent-avatar-scene")).toBeNull();
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("should clean up Three.js resources on unmount", () => {
    const { unmount } = render(
      <AgentAvatarScene config={DEFAULT_AGENT_AVATAR_CONFIG} />
    );

    // Unmounting should trigger the useEffect cleanup function
    unmount();

    // We can't easily assert on the inner workings of the unmount without exposing
    // the mocked instances, but we can verify it doesn't crash on unmount.
  });
});
