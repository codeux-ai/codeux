import { h, ComponentChildren, RefObject } from "preact";
import { useCallback, useEffect, useRef, useState, useLayoutEffect } from "preact/hooks";
import { createPortal } from "preact/compat";
import gsap from "gsap";
import { calculatePosition, Position, Alignment } from "../../lib/positioning/index.js";
import { GSAP_DURATIONS, GSAP_EASINGS } from "../../lib/motion/constants.js";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";

interface DropdownMenuProps {
  children: ComponentChildren;
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
  const [isRendered, setIsRendered] = useState(false);
  const localTriggerRef = useRef<HTMLDivElement>(null);
  const triggerRef = externalTriggerRef || localTriggerRef;
  const menuRef = useRef<HTMLDivElement>(null);
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
      setTimeout(() => {
        const first = menuRef.current?.querySelector('[role="menuitem"]:not([aria-disabled="true"])') as HTMLElement | null;
        first?.focus();
      }, 0);
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
          scale: 0.98,
        },
        {
          opacity: 1,
          scale: 1,
          duration: isReducedMotion ? 0 : GSAP_DURATIONS.base,
          ease: GSAP_EASINGS.smooth,
        }
      );
    } else if (isRendered) {
      gsap.to(menuRef.current, {
        opacity: 0,
        scale: 0.98,
        duration: isReducedMotion ? 0 : GSAP_DURATIONS.fast,
        ease: "power2.in",
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
        triggerRef.current?.focus(); // Restore focus
        return;
      }

      if (!menuRef.current) return;

      const items = Array.from(menuRef.current.querySelectorAll('[role="menuitem"]:not([aria-disabled="true"])')) as HTMLElement[];
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
          e.preventDefault();
          (document.activeElement as HTMLElement).click();
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
            className={`fixed z-[100] bg-white/92 dark:bg-void-800/92 backdrop-blur-xl border border-black/[0.08] dark:border-white/[0.08] shadow-md dark:shadow-[0_16px_36px_rgba(0,0,0,0.4)] rounded-[1.75rem] p-2 ${className}`}
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
