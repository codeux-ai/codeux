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
  const spaceBelow = Math.max(0, viewport.height - VIEWPORT_PADDING - belowTop);
  const spaceAbove = Math.max(0, triggerRect.top - MENU_GAP - VIEWPORT_PADDING);
  const canFitBelow = height <= spaceBelow;
  const canFitAbove = height <= spaceAbove;
  // When both sides fit, prefer the larger region. This stays stable if the
  // first layout pass underestimates a long menu while fonts or actions settle.
  const placeBelow = canFitBelow && (!canFitAbove || spaceBelow >= spaceAbove);
  const top = placeBelow
    ? belowTop
    : Math.max(VIEWPORT_PADDING, triggerRect.top - height - MENU_GAP);

  return {
    top,
    left,
    placement: placeBelow ? "bottom" : "top",
    transformOrigin: placeBelow ? "top right" : "bottom right",
  };
}
