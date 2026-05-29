import { h, ComponentChildren, RefObject } from "preact";
import { useCallback, useEffect, useRef, useState, useLayoutEffect } from "preact/hooks";
import { createPortal } from "preact/compat";
import gsap from "gsap";
import { calculatePosition, Position, Alignment } from "../../lib/positioning/index.js";

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
}: PopoverProps) => {
  const [isRendered, setIsRendered] = useState(false);
  const localTriggerRef = useRef<HTMLDivElement>(null);
  const triggerRef = externalTriggerRef || localTriggerRef;
  const popoverRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState({ top: 0, left: 0 });

  // Generate a unique ID for ARIA wiring if none exists
  const [popoverId] = useState(() => `popover-${Math.random().toString(36).substr(2, 9)}`);

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
    }
  }, [isOpen]);

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
      gsap.to(popoverRef.current, {
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
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        onOpenChange(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onOpenChange(false);
        triggerRef.current?.focus(); // Restore focus
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
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={isOpen ? popoverId : undefined}
      >
        {children}
      </div>

      {isRendered &&
        createPortal(
          <div
            id={popoverId}
            ref={popoverRef}
            role="dialog"
            className={`fixed z-[9999] bg-white dark:bg-void-800 border border-black/[0.08] dark:border-white/[0.08] shadow-[0_16px_36px_rgba(15,23,42,0.14)] dark:shadow-[0_16px_36px_rgba(0,0,0,0.4)] rounded-2xl p-4 ${className}`}
            style={{ top: coords.top, left: coords.left }}
          >
            {content}
          </div>,
          document.body
        )}
    </>
  );
};
