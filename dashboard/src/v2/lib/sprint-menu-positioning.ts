export interface SprintMenuRect {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface SprintMenuViewport {
  width: number;
  height: number;
}

export interface SprintMenuSize {
  width: number;
  height: number;
}

export interface SprintActionMenuPosition {
  top: number;
  left: number;
  placement: "bottom" | "top";
  transformOrigin: string;
}

const VIEWPORT_PADDING = 8;
const MENU_GAP = 8;

export function computeSprintActionMenuPosition(
  triggerRect: SprintMenuRect,
  viewport: SprintMenuViewport,
  menuSize: SprintMenuSize,
): SprintActionMenuPosition {
  const width = Math.min(menuSize.width, Math.max(0, viewport.width - VIEWPORT_PADDING * 2));
  const height = Math.min(menuSize.height, Math.max(0, viewport.height - VIEWPORT_PADDING * 2));

  const rightAlignedLeft = triggerRect.right - width;
  const maxLeft = viewport.width - width - VIEWPORT_PADDING;
  const left = Math.max(VIEWPORT_PADDING, Math.min(rightAlignedLeft, maxLeft));

  const belowTop = triggerRect.bottom + MENU_GAP;
  const canFitBelow = belowTop + height <= viewport.height - VIEWPORT_PADDING;
  const top = canFitBelow
    ? belowTop
    : Math.max(VIEWPORT_PADDING, triggerRect.top - height - MENU_GAP);

  return {
    top,
    left,
    placement: canFitBelow ? "bottom" : "top",
    transformOrigin: canFitBelow ? "top right" : "bottom right",
  };
}
