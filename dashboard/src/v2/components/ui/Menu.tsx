import { h, ComponentChildren, RefObject } from "preact";
import { useCallback, useEffect, useRef, useState, useLayoutEffect } from "preact/hooks";
import { createPortal } from "preact/compat";
import gsap from "gsap";
import { calculatePosition, Position, Alignment } from "../../lib/positioning/index.js";

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
  const [isRendered, setIsRendered] = useState(false);
  const localTriggerRef = useRef<HTMLDivElement>(null);
  const triggerRef = externalTriggerRef || localTriggerRef;
  const menuRef = useRef<HTMLDivElement>(null);
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
      setTimeout(() => {
        const first = menuRef.current?.querySelector('[role="menuitem"]:not([aria-disabled="true"])') as HTMLElement | null;
        first?.focus();
      }, 0);
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
          y: position === "bottom" ? -10 : position === "top" ? 10 : 0,
        },
        {
          opacity: 1,
          scale: 1,
          y: 0,
          duration: 0.3,
          ease: "back.out(1.7)",
        }
      );
    } else if (isRendered) {
      gsap.to(menuRef.current, {
        opacity: 0,
        scale: 0.95,
        duration: 0.15,
        ease: "power2.in",
        onComplete: () => setIsRendered(false),
      });
    }
  }, [isOpen, isRendered, position]);

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
        items[(currentIndex - 1 + items.length) % items.length]?.focus();
      } else if (e.key === "Home") {
        e.preventDefault();
        items[0]?.focus();
      } else if (e.key === "End") {
        e.preventDefault();
        items[items.length - 1]?.focus();
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
        onClick={() => onOpenChange(!isOpen)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={isOpen ? menuId : undefined}
      >
        {children}
      </div>

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
