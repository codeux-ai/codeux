import { describe, it, expect } from "vitest";
import * as THREE from "../../../dashboard/src/lib/three-lite.js";
import {
  logoPathToShapes,
  extrudeLogoPath,
} from "../../../dashboard/src/v2/lib/logo-shapes.js";
import {
  PATH_FACE_SHELL,
  PATH_EAR_LEFT,
  PATH_EAR_RIGHT,
  PATH_INSET_FACE,
  PATH_EYE_LEFT_SMILE,
  PATH_EYE_RIGHT_SMILE,
  PATH_ANTENNA_PILL,
  LOGO_ANCHORS,
  LOGO_FRAME,
} from "../../../dashboard/src/v2/lib/agent-avatar-logo.js";

const BODY_FRAME = {
  cx: LOGO_FRAME.CX,
  cy: LOGO_FRAME.CY,
  pxPerUnit: LOGO_FRAME.PX_PER_UNIT,
};

function shapeBounds(shapes: ReturnType<typeof logoPathToShapes>) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const shape of shapes) {
    for (const p of shape.getPoints(24)) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
  }
  return { minX, maxX, minY, maxY };
}

describe("logoPathToShapes", () => {
  it("parses the face shell into a single closed shape with logo-true bounds", () => {
    const shapes = logoPathToShapes(PATH_FACE_SHELL, BODY_FRAME);
    expect(shapes).toHaveLength(1);

    // Logo px: shell spans x ≈ 320→946, y ≈ 348 (head bump) → 921 (tail).
    const b = shapeBounds(shapes);
    expect(b.minX).toBeCloseTo((320 - 627) / 400, 1);
    expect(b.maxX).toBeCloseTo((946 - 627) / 400, 1);
    expect(b.maxY).toBeCloseTo((585 - 348) / 400, 1);
    expect(b.minY).toBeCloseTo((585 - 921) / 400, 1);
  });

  it("keeps the ear crescents flanking the shell symmetrically", () => {
    const left = shapeBounds(logoPathToShapes(PATH_EAR_LEFT, BODY_FRAME));
    const right = shapeBounds(logoPathToShapes(PATH_EAR_RIGHT, BODY_FRAME));
    // Left ear sits entirely left of the shell, right ear entirely right.
    expect(left.maxX).toBeLessThan((320 - 627) / 400);
    expect(right.minX).toBeGreaterThan((946 - 627) / 400);
    // Symmetric within a few logo px.
    expect(Math.abs(left.minX + right.maxX)).toBeLessThan(0.02);
  });

  it("parses the inset screen with the expected extents", () => {
    const b = shapeBounds(logoPathToShapes(PATH_INSET_FACE, BODY_FRAME));
    const halfW = LOGO_ANCHORS.insetHalfW / 400;
    expect(b.maxX - b.minX).toBeCloseTo(halfW * 2, 1);
  });

  it("centers each smile eye on its own anchor so blink scaling pivots correctly", () => {
    for (const [path, anchor] of [
      [PATH_EYE_LEFT_SMILE, LOGO_ANCHORS.eyeL],
      [PATH_EYE_RIGHT_SMILE, LOGO_ANCHORS.eyeR],
    ] as const) {
      const b = shapeBounds(
        logoPathToShapes(path, { cx: anchor.x, cy: anchor.y, pxPerUnit: 400 }),
      );
      // The arc straddles its anchor: bounds stay within ±0.2 of the origin
      // and the shape is wider than tall (it is a smile arc).
      expect(Math.abs(b.minX)).toBeLessThan(0.2);
      expect(Math.abs(b.maxX)).toBeLessThan(0.2);
      expect(b.maxX - b.minX).toBeGreaterThan(b.maxY - b.minY);
    }
  });

  it("parses the antenna pill as a thin vertical capsule above the head", () => {
    const b = shapeBounds(
      logoPathToShapes(PATH_ANTENNA_PILL, {
        cx: LOGO_ANCHORS.antennaPivot.x,
        cy: LOGO_ANCHORS.antennaPivot.y,
        pxPerUnit: 400,
      }),
    );
    expect(b.maxY - b.minY).toBeGreaterThan(b.maxX - b.minX); // taller than wide
    expect(b.minY).toBeGreaterThan(0); // entirely above the pivot
  });
});

describe("extrudeLogoPath", () => {
  it("produces centered, non-empty 3D geometry", () => {
    const geo = extrudeLogoPath(PATH_FACE_SHELL, BODY_FRAME, {
      depth: 0.3,
      bevel: 0.085,
      bevelSegments: 6,
      curveSegments: 20,
    });
    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    expect(pos.count).toBeGreaterThan(100);
    // z is centered: extrusion spans ±(depth/2 + bevel)
    let minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      minZ = Math.min(minZ, pos.getZ(i));
      maxZ = Math.max(maxZ, pos.getZ(i));
    }
    expect(minZ).toBeCloseTo(-(0.15 + 0.085), 2);
    expect(maxZ).toBeCloseTo(0.15 + 0.085, 2);
    geo.dispose();
  });
});
