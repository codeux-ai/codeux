import { describe, expect, test } from "vitest";
import {
    MEMORY_CAMERA,
    clampCameraZoom,
    focusCameraOnPoint,
    screenToWorldPoint,
    stepCameraZoom,
    worldToScreenPoint,
    zoomCameraTowardPoint,
} from "../../lib/memory-camera.js";

describe("memory camera", () => {
    test("clamps zoom to the configured range", () => {
        expect(clampCameraZoom(MEMORY_CAMERA.minZoom - 2)).toBe(MEMORY_CAMERA.minZoom);
        expect(clampCameraZoom(MEMORY_CAMERA.maxZoom + 2)).toBe(MEMORY_CAMERA.maxZoom);
    });

    test("keeps the world point under the cursor stable while zooming", () => {
        const camera = { x: 140, y: -80, zoom: 1.1 };
        const viewport = { width: 1280, height: 720 };
        const pointer = { x: 910, y: 260 };

        const before = screenToWorldPoint(camera, viewport, pointer);
        const target = zoomCameraTowardPoint(camera, viewport, pointer, 4.2);
        const after = screenToWorldPoint(target, viewport, pointer);

        expect(target.zoom).toBe(4.2);
        expect(after.x).toBeCloseTo(before.x, 10);
        expect(after.y).toBeCloseTo(before.y, 10);
    });

    test("clamps wheel and button steps to the readable limits", () => {
        const camera = { x: 0, y: 0, zoom: MEMORY_CAMERA.maxZoom - 0.1 };
        const viewport = { width: 1000, height: 800 };
        const center = { x: 500, y: 400 };

        const zoomedOut = stepCameraZoom({ x: 0, y: 0, zoom: MEMORY_CAMERA.minZoom + 0.05 }, -1);
        const zoomedIn = zoomCameraTowardPoint(camera, viewport, center, camera.zoom + 1);

        expect(zoomedOut.zoom).toBe(MEMORY_CAMERA.minZoom);
        expect(zoomedIn.zoom).toBe(MEMORY_CAMERA.maxZoom);
        expect(worldToScreenPoint(zoomedIn, viewport, { x: 0, y: 0 }).x).toBeCloseTo(worldToScreenPoint(camera, viewport, { x: 0, y: 0 }).x, 10);
    });

    test("centers focused nodes at the selected-node zoom", () => {
        const focused = focusCameraOnPoint({ x: -240, y: 180 });

        expect(focused).toEqual({
            x: -240,
            y: 180,
            zoom: MEMORY_CAMERA.selectedNodeZoom,
        });
    });
});
