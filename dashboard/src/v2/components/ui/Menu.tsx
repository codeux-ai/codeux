import { h, ComponentChildren, RefObject, isValidElement, cloneElement } from "preact";
import { useCallback, useEffect, useRef, useState, useLayoutEffect } from "preact/hooks";
import { createPortal } from "preact/compat";
import gsap from "gsap";
import { calculatePosition, Position, Alignment } from "../../lib/positioning/index.js";
import { MOTION_TOKENS } from "../../lib/motion/tokens.js";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";

interface MenuProps {
  children: ComponentChildren;
  content: ComponentChildren;
  position?: Position;
  align?: Alignment;
  gap?: number;
  className?: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  triggerRef?: RefObject<HTMLElement>;
}

export const Menu = ({
  children,
  content,
  position = "bottom",
  align = "start",
  gap = 8,
  className = "",
  isOpen,
  onOpenChange,
  triggerRef: externalTriggerRef,
}: MenuProps) => {
  const isReducedMotion = useReducedMotion();
  const [isRendered, setIsRendered] = useState(false);
  const localTriggerRef = useRef<HTMLDivElement>(null);
  const triggerRef = externalTriggerRef || localTriggerRef;
  const menuRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [coords, setCoords] = useState({ top: 0, left: 0 });

  // Generate a unique ID for ARIA wiring if none exists
  const [menuId] = useState(() => `menu-${Math.random().toString(36).substr(2, 9)}`);

  const updatePosition = useCallback(() => {
    if (!triggerRef.current || !menuRef.current) return;

    const { top, left } = calculatePosition({
      triggerRect: triggerRef.current.getBoundingClientRect(),
      contentRect: menuRef.current.getBoundingClientRect(),
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
      previousFocusRef.current = document.activeElement as HTMLElement | null;
      setTimeout(() => {
        const first = menuRef.current?.querySelector('[role="menuitem"]:not([disabled]):not([aria-disabled="true"])') as HTMLElement | null;
        first?.focus();
      }, 0);
    } else if (isRendered) { // Only restore if it was previously open
      // Restore focus on close
      if (
        !document.activeElement ||
        document.activeElement === document.body ||
        (menuRef.current && menuRef.current.contains(document.activeElement))
      ) {
        if (previousFocusRef.current?.isConnected) {
          previousFocusRef.current.focus();
          previousFocusRef.current = null;
        } else if (triggerRef.current?.isConnected) {
          triggerRef.current.focus();
        }
      }
    }
  }, [isOpen]);

  useLayoutEffect(() => {
    if (isOpen) updatePosition();
  }, [isOpen, updatePosition]);

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
          duration: isReducedMotion ? 0 : parseFloat(MOTION_TOKENS.timing.fast) / 1000,
          ease: MOTION_TOKENS.easing.standard,
        }
      );
    } else if (isRendered) {
      gsap.to(menuRef.current, {
        opacity: 0,
        scale: 0.95,
        y: position === "bottom" ? -5 : position === "top" ? 5 : 0,
        duration: isReducedMotion ? 0 : parseFloat(MOTION_TOKENS.timing.fast) / 1000,
        ease: MOTION_TOKENS.easing.standard,
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

      const items = Array.from(menuRef.current.querySelectorAll('[role="menuitem"]:not([disabled]):not([aria-disabled="true"]), button:not([disabled]):not([aria-disabled="true"]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')) as HTMLElement[];
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
      {isValidElement(children) ? cloneElement(children as preact.VNode<any>, {
        ref: externalTriggerRef ? undefined : localTriggerRef,
        onClick: (e: MouseEvent) => {
          onOpenChange(!isOpen);
          if ((children.props as any).onClick) (children.props as any).onClick(e);
        },
        "aria-haspopup": "menu",
        "aria-expanded": isOpen,
        "aria-controls": isOpen ? menuId : undefined,
      }) : (
        <button
          type="button"
          ref={externalTriggerRef ? undefined : (localTriggerRef as unknown as RefObject<HTMLButtonElement>)}
          className="inline-flex cursor-pointer text-left"
          onClick={() => onOpenChange(!isOpen)}
          aria-haspopup="menu"
          aria-expanded={isOpen}
          aria-controls={isOpen ? menuId : undefined}
        >
          {children}
        </button>
      )}

      {isRendered &&
        createPortal(
          <div
            id={menuId}
            ref={menuRef}
            role="menu"
            className={`fixed z-[9999] bg-white dark:bg-void-800 border border-black/[0.08] dark:border-white/[0.08] shadow-[0_16px_36px_rgba(15,23,42,0.14)] dark:shadow-[0_16px_36px_rgba(0,0,0,0.4)] rounded-2xl p-2 ${className}`}
            style={{ top: coords.top, left: coords.left }}
          >
            {content}
          </div>,
          document.body
        )}
    </>
  );
};
