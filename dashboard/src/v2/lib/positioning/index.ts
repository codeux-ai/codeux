export type Position = "top" | "bottom" | "left" | "right";
export type Alignment = "start" | "center" | "end";

interface CalculatePositionArgs {
    triggerRect: DOMRect;
    contentRect: DOMRect;
    position: Position;
    align?: Alignment;
    gap?: number;
    padding?: number;
    viewportWidth?: number;
    viewportHeight?: number;
}

export function calculatePosition({
    triggerRect,
    contentRect,
    position,
    align = "center",
    gap = 8,
    padding = 8,
    viewportWidth = window.innerWidth,
    viewportHeight = window.innerHeight,
}: CalculatePositionArgs) {
    let top = 0;
    let left = 0;

    switch (position) {
        case "top":
            top = triggerRect.top - contentRect.height - gap;
            break;
        case "bottom":
            top = triggerRect.bottom + gap;
            break;
        case "left":
            left = triggerRect.left - contentRect.width - gap;
            break;
        case "right":
            left = triggerRect.right + gap;
            break;
    }

    if (position === "top" || position === "bottom") {
        switch (align) {
            case "start":
                left = triggerRect.left;
                break;
            case "center":
                left = triggerRect.left + triggerRect.width / 2 - contentRect.width / 2;
                break;
            case "end":
                left = triggerRect.right - contentRect.width;
                break;
        }
    } else {
        switch (align) {
            case "start":
                top = triggerRect.top;
                break;
            case "center":
                top = triggerRect.top + triggerRect.height / 2 - contentRect.height / 2;
                break;
            case "end":
                top = triggerRect.bottom - contentRect.height;
                break;
        }
    }

    // Boundary checks with fallback positions
    if (position === "top" || position === "bottom") {
        if (left < padding) left = padding;
        if (left + contentRect.width > viewportWidth - padding) {
            left = viewportWidth - contentRect.width - padding;
        }

        // Vertical collision
        if (position === "top" && top < padding) {
            top = triggerRect.bottom + gap; // Flip to bottom
        } else if (position === "bottom" && top + contentRect.height > viewportHeight - padding) {
            top = triggerRect.top - contentRect.height - gap; // Flip to top
        }
    } else {
         if (top < padding) top = padding;
         if (top + contentRect.height > viewportHeight - padding) {
            top = viewportHeight - contentRect.height - padding;
         }

         // Horizontal collision
         if (position === "left" && left < padding) {
             left = triggerRect.right + gap; // Flip to right
         } else if (position === "right" && left + contentRect.width > viewportWidth - padding) {
             left = triggerRect.left - contentRect.width - gap; // Flip to left
         }
    }

    // Final boundary safeguard
    if (top < padding) top = padding;
    if (left < padding) left = padding;

    return { top, left };
}
