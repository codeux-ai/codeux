import { h, ComponentChildren, RefObject, isValidElement, cloneElement } from "preact";
import { useCallback, useEffect, useRef, useState, useLayoutEffect } from "preact/hooks";
import { createPortal } from "preact/compat";
import gsap from "gsap";
import { calculatePosition, Position, Alignment } from "../../lib/positioning/index.js";
import { useGsapInteractionTokens } from "../../lib/motion/constants.js";
import { restoreFocusSafely, useFocusTrap } from "../../hooks/use-focus-trap.js";

interface PopoverProps {
  children: ComponentChildren;
  content: ComponentChildren;
  position?: Position;
  align?: Alignment;
  gap?: number;
  className?: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  triggerRef?: RefObject<HTMLElement>;
  isTooltip?: boolean;
  ariaLabel?: string;
}

function assignRef<T>(ref: unknown, value: T | null): void {
  if (!ref) return;
  if (typeof ref === "function") {
    ref(value);
    return;
  }
  (ref as { current: T | null }).current = value;
}

export const Popover = ({
  children,
  content,
  position = "bottom",
  align = "center",
  gap = 8,
  className = "",
  isOpen,
  onOpenChange,
  triggerRef: externalTriggerRef,
  isTooltip = false,
  ariaLabel,
}: PopoverProps) => {
  const focusTrapRef = useFocusTrap(!isTooltip && isOpen, { onClose: () => onOpenChange(false), restoreFocus: true });
  const gsapTokens = useGsapInteractionTokens();
  const [isRendered, setIsRendered] = useState(false);
  const localTriggerRef = useRef<HTMLButtonElement>(null);
  const triggerRef = externalTriggerRef || localTriggerRef;
  const popoverRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [coords, setCoords] = useState({ top: 0, left: 0 });

  // Generate a unique ID for ARIA wiring if none exists
  const [popoverId] = useState(() => `popover-${Math.random().toString(36).substr(2, 9)}`);

  const restoreFocus = useCallback(() => {
    if (isTooltip) return;
    restoreFocusSafely(previousFocusRef.current, triggerRef.current);
    previousFocusRef.current = null;
  }, [isTooltip, triggerRef]);

  const updatePosition = useCallback(() => {
    if (!triggerRef.current || !popoverRef.current) return;

    const { top, left } = calculatePosition({
      triggerRect: triggerRef.current.getBoundingClientRect(),
      contentRect: popoverRef.current.getBoundingClientRect(),
      position,
      align,
      gap,
      padding: 8,
    });
    setCoords({ top, left });
  }, [align, gap, position, triggerRef]);

  useEffect(() => {
    if (isOpen) {
      setIsRendered(true);
      if (!isTooltip) {
        previousFocusRef.current = document.activeElement as HTMLElement | null;
      }
    } else if (isRendered) {
      restoreFocus();
    }
  }, [isOpen, isRendered, isTooltip, restoreFocus]);

  // Position once the portal has actually mounted. `isRendered` flips in a
  // separate effect after `isOpen`, so depending on it here guarantees the
  // popover element exists (and is measurable) before we compute coordinates —
  // otherwise it stays pinned at the top-left {0,0} default.
  useLayoutEffect(() => {
    if (isOpen && isRendered) updatePosition();
  }, [isOpen, isRendered, updatePosition]);

  useEffect(() => {
    if (!isOpen) return undefined;

    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, { capture: true, passive: true });

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, { capture: true });
    };
  }, [isOpen, updatePosition]);

  useLayoutEffect(() => {
    if (!popoverRef.current) return;

    gsap.killTweensOf(popoverRef.current);

    if (isOpen) {
      gsap.fromTo(
        popoverRef.current,
        {
          opacity: 0,
          scale: 0.95,
          y: position === "bottom" ? -5 : position === "top" ? 5 : 0,
        },
        {
          opacity: 1,
          scale: 1,
          y: 0,
          duration: gsapTokens.enterExit.duration,
          ease: gsapTokens.enterExit.ease,
        }
      );
    } else if (isRendered) {
      gsap.to(popoverRef.current, {
        opacity: 0,
        scale: 0.95,
        y: position === "bottom" ? -5 : position === "top" ? 5 : 0,
        duration: gsapTokens.enterExit.duration,
        ease: gsapTokens.enterExit.ease,
        onComplete: () => setIsRendered(false),
      });
    }
  }, [isOpen, isRendered, position, gsapTokens.enterExit.duration, gsapTokens.enterExit.ease]);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (
        isOpen &&
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        (!triggerRef.current || !triggerRef.current.contains(e.target as Node))
      ) {
        onOpenChange(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        e.preventDefault();
        e.stopPropagation();
        onOpenChange(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleOutsideClick);
      document.addEventListener("keydown", handleKeyDown);
    }

    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onOpenChange]);

  return (
    <>
      {isValidElement(children) && (children.type === 'button' || (children.props as any).role === 'button') ? (
        cloneElement(children as preact.VNode<any>, {
          "aria-haspopup": isTooltip ? ("true" as const) : ("dialog" as const),
          "aria-expanded": isOpen,
          "aria-controls": popoverId,
          "aria-label": (children.props as any)["aria-label"],
          disabled: (children.props as any).disabled,
          onClick: (e: MouseEvent) => {
            if (!(children.props as any).disabled) {
              onOpenChange(!isOpen);
            }
            (children.props as any).onClick?.(e);
          },
          onKeyDown: (e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              if (!(children.props as any).disabled) {
                onOpenChange(!isOpen);
              }
            }
            (children.props as any).onKeyDown?.(e);
          },
          ref: (node: any) => {
            if (externalTriggerRef) {
              assignRef(externalTriggerRef, node);
            } else {
              (localTriggerRef as any).current = node;
            }
            assignRef((children as any).ref, node);
          },
        })
      ) : (
      <button
        type="button"
        ref={(node) => {
          if (externalTriggerRef) {
            assignRef(externalTriggerRef, node);
          } else {
            assignRef(localTriggerRef, node);
          }
        }}
        className="inline-flex cursor-pointer text-left"
        onClick={() => onOpenChange(!isOpen)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpenChange(!isOpen);
          }
        }}
        aria-haspopup={isTooltip ? "true" : "dialog"}
        aria-expanded={isOpen}
        aria-controls={popoverId}
      >
        {children}
      </button>
      )}

      {isRendered &&
        createPortal(
          <div
            id={popoverId}
            ref={(node) => {
              // @ts-ignore - Preact refs can be functions
              popoverRef.current = node;
              if (focusTrapRef) {
                // @ts-ignore - Preact refs can be functions
                focusTrapRef.current = node;
              }
            }}
            role={isTooltip ? "tooltip" : "dialog"}
            aria-label={ariaLabel || (!isTooltip ? "Dialog" : undefined)}
            tabIndex={-1}
            className={`fixed z-[9999] bg-white dark:bg-void-800 border border-black/[0.08] dark:border-white/[0.08] shadow-[0_16px_36px_rgba(15,23,42,0.14)] dark:shadow-[0_16px_36px_rgba(0,0,0,0.4)] rounded-2xl p-4 ${!isOpen ? "pointer-events-none" : ""} ${className}`}
            style={{ top: coords.top, left: coords.left }}
          >
            {content}
          </div>,
          document.body
        )}
    </>
  );
};
