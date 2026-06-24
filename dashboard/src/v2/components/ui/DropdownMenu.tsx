import { h, ComponentChildren, RefObject } from "preact";
import { useCallback, useEffect, useRef, useState, useLayoutEffect } from "preact/hooks";
import { createPortal } from "preact/compat";
import gsap from "gsap";
import { calculatePosition, Position, Alignment } from "../../lib/positioning/index.js";
import { useGsapInteractionTokens } from "../../lib/motion/constants.js";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";

interface DropdownMenuProps {
  children: ComponentChildren;
  /**
   * The content of the dropdown menu.
   * Note: All interactive items within content must have `role="menuitem"` for keyboard navigation to work.
   */
  content: ComponentChildren;
  position?: Position;
  align?: Alignment;
  gap?: number;
  className?: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  triggerRef?: RefObject<HTMLElement>;
  computePosition?: (args: {
    triggerRect: DOMRect;
    menuRect: DOMRect;
    viewport: { width: number; height: number };
    defaultPosition: Position;
    defaultAlign: Alignment;
    gap: number;
  }) => {
    top: number;
    left: number;
    transformOrigin?: string;
  };
}

export const DropdownMenu = ({
  children,
  content,
  position = "bottom",
  align = "start",
  gap = 8,
  className = "",
  isOpen,
  onOpenChange,
  triggerRef: externalTriggerRef,
  computePosition,
}: DropdownMenuProps) => {
  const isReducedMotion = useReducedMotion();
  const gsapTokens = useGsapInteractionTokens();
  const [isRendered, setIsRendered] = useState(false);
  const localTriggerRef = useRef<HTMLDivElement>(null);
  const triggerRef = externalTriggerRef || localTriggerRef;
  const menuRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const [transformOrigin, setTransformOrigin] = useState<string>("top center");

  // Generate a unique ID for ARIA wiring if none exists
  const [menuId] = useState(() => `menu-${Math.random().toString(36).substr(2, 9)}`);

  const updatePosition = useCallback(() => {
    if (!triggerRef.current || !menuRef.current) return;

    const triggerRect = triggerRef.current.getBoundingClientRect();
    const menuRect = menuRef.current.getBoundingClientRect();
    if (computePosition) {
      const custom = computePosition({
        triggerRect,
        menuRect,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
        },
        defaultPosition: position,
        defaultAlign: align,
        gap,
      });
      setCoords({ top: custom.top, left: custom.left });
      setTransformOrigin(custom.transformOrigin ?? "top center");
      return;
    }
    const { top, left } = calculatePosition({
      triggerRect,
      contentRect: menuRect,
      position,
      align,
      gap,
      padding: 8,
    });
    setCoords({ top, left });
    setTransformOrigin("top center");
  }, [align, computePosition, gap, position, triggerRef]);

  useEffect(() => {
    if (isOpen) {
      setIsRendered(true);
      previousFocusRef.current = document.activeElement as HTMLElement | null;
    } else if (isRendered) { // Only restore if it was previously open
      // Restore focus on close
      if (
        !document.activeElement ||
        document.activeElement === document.body ||
        (menuRef.current && menuRef.current.contains(document.activeElement))
      ) {
        if (previousFocusRef.current?.isConnected) {
          previousFocusRef.current.focus({ preventScroll: true });
          previousFocusRef.current = null;
        } else if (triggerRef.current?.isConnected) {
          triggerRef.current.focus({ preventScroll: true });
        }
      }
    }
  }, [isOpen]);

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
    if (!menuRef.current) return;

    gsap.killTweensOf(menuRef.current);



    if (isOpen) {
      gsap.fromTo(
        menuRef.current,
        {
          opacity: 0,
          scale: 0.95,
          y: position === "bottom" ? -5 : position === "top" ? 5 : 0,
        },
        {
          opacity: 1,
          scale: 1,
          y: 0,
          duration: isReducedMotion ? 0 : gsapTokens.enterExit.duration,
          ease: gsapTokens.enterExit.ease,
        }
      );
      requestAnimationFrame(() => {
        const firstItem = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled]):not([aria-disabled="true"])');
        firstItem?.focus({ preventScroll: true });
      });
    } else if (isRendered) {
      gsap.to(menuRef.current, {
        opacity: 0,
        scale: 0.95,
        y: position === "bottom" ? -5 : position === "top" ? 5 : 0,
        duration: isReducedMotion ? 0 : gsapTokens.enterExit.duration,
        ease: gsapTokens.enterExit.ease,
        onComplete: () => setIsRendered(false),
      });
    }
  }, [isOpen, isRendered, position, isReducedMotion]);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (
        isOpen &&
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        onOpenChange(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === "Escape") {
        onOpenChange(false);
        return;
      }

      if (!menuRef.current) return;

      const items = Array.from(menuRef.current.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled]):not([aria-disabled="true"])')) as HTMLElement[];
      if (items.length === 0) return;

      const currentIndex = items.findIndex((item) => item === document.activeElement);

      if (e.key === "ArrowDown") {
        e.preventDefault();
        items[(currentIndex + 1) % items.length]?.focus();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const nextIndex = currentIndex === -1 ? items.length - 1 : (currentIndex - 1 + items.length) % items.length;
        items[nextIndex]?.focus();
      } else if (e.key === "Home") {
        e.preventDefault();
        items[0]?.focus();
      } else if (e.key === "End") {
        e.preventDefault();
        items[items.length - 1]?.focus();
      } else if (e.key === "Enter" || e.key === " ") {
        if (document.activeElement && items.includes(document.activeElement as HTMLElement)) {
          // Check if the element handles Enter/Space itself, otherwise we click it.
          // Native buttons and links handle Enter/Space natively on focus, but we'll manually dispatch a click if it's a generic menuitem
          if (document.activeElement.getAttribute('role') === 'menuitem') {
            e.preventDefault();
            (document.activeElement as HTMLElement).click();
          }
        }
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
      <div
        ref={externalTriggerRef ? undefined : localTriggerRef}
        className="inline-flex cursor-pointer"
        onClick={(e) => { e.stopPropagation(); onOpenChange(!isOpen); }}
        onKeyDown={(e) => {
          if (!externalTriggerRef && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            onOpenChange(!isOpen);
          }
        }}
        tabIndex={!externalTriggerRef ? 0 : undefined}
        role={!externalTriggerRef ? "button" : undefined}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={isOpen ? menuId : undefined}
      >
        {children}
      </div>

      {isRendered && typeof document !== "undefined" &&
        createPortal(
          <div
            id={menuId}
            ref={menuRef}
            role="menu"
            className={`fixed z-[100] bg-white/92 dark:bg-void-800/92 backdrop-blur-xl border border-black/[0.08] dark:border-white/[0.08] shadow-md dark:shadow-[0_16px_36px_rgba(0,0,0,0.4)] rounded-[1.75rem] p-2 ${!isOpen ? "pointer-events-none" : ""} ${className}`}
            style={{ top: coords.top, left: coords.left, transformOrigin }}
            onClick={(e) => e.stopPropagation()}
          >
            {content}
          </div>,
          document.body
        )}
    </>
  );
};
