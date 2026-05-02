/** @vitest-environment jsdom */
/** @jsx h */
import { h } from "preact";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";

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

// vi.mock is hoisted — all helper classes must be declared inline
vi.mock("../../../dashboard/src/lib/three-lite.js", () => {
  const mockVec = () => ({ x: 0, y: 0, z: 0, set: vi.fn(), copy: vi.fn() });
  const mockEuler = () => ({ x: 0, y: 0, z: 0, set: vi.fn(), copy: vi.fn() });
  const mockScale = () => ({ x: 1, y: 1, z: 1, set: vi.fn(), setY: vi.fn(), copy: vi.fn() });

  class Base {
    position = mockVec();
    rotation = mockEuler();
    scale = mockScale();
    children: any[] = [];
    add(c: any) { this.children.push(c); }
    traverse(fn: any) { 
      fn(this); 
      this.children.forEach((c: any) => { 
        if (c.traverse) c.traverse(fn); 
        else fn(c); 
      }); 
    }
  }

  return {
    Scene: class extends Base {},
    PerspectiveCamera: class extends Base {
      aspect = 1;
      lookAt() {}
      updateProjectionMatrix() {}
    },
    AmbientLight: class extends Base {},
    DirectionalLight: class extends Base {},
    PointLight: class extends Base {},
    Group: class extends Base { isGroup = true; },
    Mesh: class extends Base { 
      isMesh = true; 
      geometry: any;
      material: any;
      constructor(geometry?: any, material?: any) {
        super();
        this.geometry = geometry || { type: "MockGeo", dispose: vi.fn(), scale: vi.fn() };
        this.material = material || { opacity: 0, dispose: vi.fn() };
      }
    },
    Points: class extends Base { 
      isPoints = true; 
      geometry: any;
      material: any;
      constructor(geometry?: any, material?: any) {
        super();
        this.geometry = geometry || { type: "MockGeo", dispose: vi.fn(), scale: vi.fn() };
        this.material = material || { opacity: 0, dispose: vi.fn() };
      }
    },
    MeshStandardMaterial: class { dispose() {} color = { setHex: vi.fn() }; },
    MeshPhysicalMaterial: class { dispose() {} color = { setHex: vi.fn() }; },
    MeshBasicMaterial: class { opacity = 0; dispose() {} color = { setHex: vi.fn() }; },
    PointsMaterial: class { dispose() {} },
    ShaderMaterial: class {
      uniforms: any;
      constructor(opts: any = {}) { this.uniforms = opts.uniforms || {}; }
      dispose() {}
    },
    SphereGeometry: class { type = "SphereGeometry"; scale() {} dispose() {} },
    CylinderGeometry: class { type = "CylinderGeometry"; dispose() {} },
    CapsuleGeometry: class { type = "CapsuleGeometry"; dispose() {} },
    BoxGeometry: class { type = "BoxGeometry"; scale() {} dispose() {} },
    TorusGeometry: class { type = "TorusGeometry"; dispose() {} },
    CircleGeometry: class { type = "CircleGeometry"; dispose() {} },
    LatheGeometry: class { type = "LatheGeometry"; dispose() {} },
    PlaneGeometry: class { type = "PlaneGeometry"; dispose() {} },
    RingGeometry: class { type = "RingGeometry"; dispose() {} },
    BufferGeometry: class {
      setAttribute() {}
      getAttribute() {
        return { count: 0, getX: () => 0, getY: () => 0, setX: vi.fn(), setY: vi.fn(), needsUpdate: false };
      }
      dispose() {}
    },
    BufferAttribute: class { constructor(_a?: any, _b?: any) {} },
    Float32BufferAttribute: class { constructor(_a?: any, _b?: any) {} },
    Vector2: class { x = 0; y = 0; constructor(x?: number, y?: number) { this.x = x ?? 0; this.y = y ?? 0; } },
    Vector3: class { x = 0; y = 0; z = 0; constructor(x?: number, y?: number, z?: number) { this.x = x ?? 0; this.y = y ?? 0; this.z = z ?? 0; } set() { return this; } copy() { return this; } },
    Color: class { r = 1; g = 1; b = 1; constructor(_n?: any) {} },
    CubeTexture: class { needsUpdate = false; },
    CanvasTexture: class { wrapS = 0; wrapT = 0; needsUpdate = false; },
    Texture: class { needsUpdate = false; },
    SpotLight: class extends Base {},
    RepeatWrapping: 1000,
    AdditiveBlending: 2,
    NormalBlending: 1,
    MathUtils: { lerp: (s: number, e: number, a: number) => s + (e - s) * a },
    ACESFilmicToneMapping: 0,
    WebGLRenderer: class {
      setSize() {}
      setPixelRatio() {}
      toneMapping = 0;
      toneMappingExposure = 1;
      domElement = document.createElement("canvas");
      render() {}
      dispose() {}
    },
  };
});

// Import after mock
import { AgentAvatarScene } from "../../../dashboard/src/v2/components/agents/AgentAvatarScene.js";
import { DEFAULT_AGENT_AVATAR_CONFIG } from "../../../dashboard/src/v2/lib/agent-avatar.js";

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
    const { getByTestId, queryByTestId } = render(
      <AgentAvatarScene config={DEFAULT_AGENT_AVATAR_CONFIG} fallbackMode={true} />
    );
    expect(getByTestId("agent-avatar-fallback")).toBeInTheDocument();
    expect(queryByTestId("agent-avatar-scene")).toBeNull();
  });

  it("should clean up Three.js resources on unmount", () => {
    const { unmount } = render(
      <AgentAvatarScene config={DEFAULT_AGENT_AVATAR_CONFIG} />
    );
    unmount();
  });
});
