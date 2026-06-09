/**
 * logo-shapes — converts the brand-mark SVG paths into THREE.Shape objects
 * so the 3D avatar extrudes the *exact* logo silhouette instead of
 * approximating it with primitive geometry.
 *
 * The brand paths only use absolute M / L / C / Z commands (with implicit
 * command repetition), so the parser is deliberately tiny. Coordinates are
 * mapped from logo pixel space into scene units with a y-flip:
 *
 *    sceneX = (px.x - frame.cx) / frame.pxPerUnit
 *    sceneY = (frame.cy - px.y) / frame.pxPerUnit
 */
import * as THREE from "../../lib/three-lite.js";

export interface LogoShapeFrame {
  /** Logo-space x that becomes scene x = 0. */
  cx: number;
  /** Logo-space y that becomes scene y = 0. */
  cy: number;
  /** Logo pixels per scene unit. */
  pxPerUnit: number;
}

const TOKEN_RE = /[MLCZmlcz]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;

/** Parse an absolute-command SVG path into one THREE.Shape per subpath. */
export function logoPathToShapes(d: string, frame: LogoShapeFrame): THREE.Shape[] {
  const tokens = d.match(TOKEN_RE) ?? [];
  const shapes: THREE.Shape[] = [];
  let shape: THREE.Shape | null = null;
  let cmd = "";
  let i = 0;

  const tx = (x: number) => (x - frame.cx) / frame.pxPerUnit;
  const ty = (y: number) => (frame.cy - y) / frame.pxPerUnit;
  const num = () => parseFloat(tokens[i++]);

  while (i < tokens.length) {
    const tok = tokens[i];
    if (/^[MLCZmlcz]$/.test(tok)) {
      cmd = tok.toUpperCase();
      i++;
      if (cmd === "Z") {
        shape?.closePath();
        cmd = "";
      }
      continue;
    }
    if (cmd === "M") {
      shape = new THREE.Shape();
      shapes.push(shape);
      shape.moveTo(tx(num()), ty(num()));
      cmd = "L"; // additional pairs after a moveto are implicit linetos
    } else if (cmd === "L") {
      shape?.lineTo(tx(num()), ty(num()));
    } else if (cmd === "C") {
      shape?.bezierCurveTo(tx(num()), ty(num()), tx(num()), ty(num()), tx(num()), ty(num()));
    } else {
      i++; // stray number with no active command — skip defensively
    }
  }
  return shapes;
}

/** Extrude a brand path into centered 3D geometry (z spans ±depth/2). */
export function extrudeLogoPath(
  d: string,
  frame: LogoShapeFrame,
  opts: { depth: number; bevel: number; bevelSegments?: number; curveSegments?: number },
): THREE.BufferGeometry {
  const shapes = logoPathToShapes(d, frame);
  const geo = new THREE.ExtrudeGeometry(shapes, {
    depth: opts.depth,
    bevelEnabled: true,
    bevelSize: opts.bevel,
    bevelThickness: opts.bevel,
    bevelSegments: opts.bevelSegments ?? 4,
    curveSegments: opts.curveSegments ?? 14,
  });
  geo.translate(0, 0, -opts.depth / 2);
  return geo;
}
