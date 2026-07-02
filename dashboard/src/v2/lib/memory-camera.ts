export interface CameraState {
    x: number;
    y: number;
    zoom: number;
}

export interface ViewportSize {
    width: number;
    height: number;
}

export interface Point {
    x: number;
    y: number;
}

export const MEMORY_CAMERA = {
    minZoom: 0.35,
    defaultZoom: 1,
    selectedNodeZoom: 2.4,
    deepReadableZoom: 4.8,
    maxZoom: 6.5,
    entryZoom: 0.55,
    wheelStep: 0.18,
    buttonStep: 0.45,
} as const;

export function clampCameraZoom(zoom: number): number {
    return Math.max(MEMORY_CAMERA.minZoom, Math.min(MEMORY_CAMERA.maxZoom, zoom));
}

export function screenToWorldPoint(camera: CameraState, viewport: ViewportSize, point: Point): Point {
    return {
        x: (point.x - viewport.width / 2) / camera.zoom + camera.x,
        y: (point.y - viewport.height / 2) / camera.zoom + camera.y,
    };
}

export function worldToScreenPoint(camera: CameraState, viewport: ViewportSize, point: Point): Point {
    return {
        x: (point.x - camera.x) * camera.zoom + viewport.width / 2,
        y: (point.y - camera.y) * camera.zoom + viewport.height / 2,
    };
}

export function zoomCameraTowardPoint(
    camera: CameraState,
    viewport: ViewportSize,
    point: Point,
    nextZoom: number,
): CameraState {
    const zoom = clampCameraZoom(nextZoom);
    const worldPoint = screenToWorldPoint(camera, viewport, point);

    return {
        x: worldPoint.x - (point.x - viewport.width / 2) / zoom,
        y: worldPoint.y - (point.y - viewport.height / 2) / zoom,
        zoom,
    };
}

export function focusCameraOnPoint(point: Point, zoom: number = MEMORY_CAMERA.selectedNodeZoom): CameraState {
    return {
        x: point.x,
        y: point.y,
        zoom: clampCameraZoom(zoom),
    };
}

export function stepCameraZoom(camera: CameraState, delta: number): CameraState {
    return {
        ...camera,
        zoom: clampCameraZoom(camera.zoom + delta),
    };
}
