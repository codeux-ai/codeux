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
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

const mockVec3 = () => ({ x: 0, y: 0, z: 0, set: vi.fn(), copy: vi.fn() });
const mockEuler = () => ({ x: 0, y: 0, z: 0, set: vi.fn(), copy: vi.fn() });
const mockScale = () => ({ x: 1, y: 1, z: 1, set: vi.fn(), setY: vi.fn(), copy: vi.fn() });

class MockObject3D {
  position = mockVec3();
  rotation = mockEuler();
  scale = mockScale();
  children: any[] = [];
  add(child: any) { this.children.push(child); }
  geometry = { type: "MockGeometry" };
}

// Mock Three.js
vi.mock("three", () => {
  return {
    Scene: class extends MockObject3D {},
    PerspectiveCamera: class extends MockObject3D {
      aspect = 1;
      lookAt() {}
      updateProjectionMatrix() {}
    },
    AmbientLight: class extends MockObject3D {},
    DirectionalLight: class extends MockObject3D {},
    Group: class extends MockObject3D {
      isGroup = true;
    },
    Mesh: class extends MockObject3D {
      material = { opacity: 0, dispose: vi.fn() };
    },
    Points: class extends MockObject3D {},
    MeshStandardMaterial: class {
      dispose() {}
      color = { setHex: vi.fn() };
    },
    MeshBasicMaterial: class {
      opacity = 0;
      dispose() {}
      color = { setHex: vi.fn() };
    },
    PointsMaterial: class {
      dispose() {}
    },
    SphereGeometry: class {
      type = "SphereGeometry";
      scale() {}
      dispose() {}
    },
    CylinderGeometry: class {
      type = "CylinderGeometry";
      dispose() {}
    },
    CapsuleGeometry: class {
      type = "CapsuleGeometry";
      dispose() {}
    },
    BoxGeometry: class {
      type = "BoxGeometry";
      scale() {}
      dispose() {}
    },
    TorusGeometry: class {
      type = "TorusGeometry";
      dispose() {}
    },
    CircleGeometry: class {
      type = "CircleGeometry";
      dispose() {}
    },
    BufferGeometry: class {
      setAttribute() {}
      getAttribute() {
        return {
          count: 0,
          getX: () => 0,
          getY: () => 0,
          setX: vi.fn(),
          setY: vi.fn(),
          needsUpdate: false,
        };
      }
      dispose() {}
    },
    BufferAttribute: class {},
    Vector3: class {
      x = 0; y = 0; z = 0;
      set() { return this; }
      copy() { return this; }
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
    unmount();
    // Verify it doesn't crash on unmount.
  });
});
