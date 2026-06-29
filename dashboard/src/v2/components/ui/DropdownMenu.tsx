import { h, ComponentChildren, RefObject, isValidElement, cloneElement, toChildArray, VNode } from "preact";
import { useCallback, useEffect, useRef, useState, useLayoutEffect } from "preact/hooks";
import { createPortal } from "preact/compat";
import type { JSX } from "preact";
import gsap from "gsap";
import { calculatePosition, Position, Alignment } from "../../lib/positioning/index.js";
import { useGsapInteractionTokens, GSAP_DURATIONS } from "../../lib/motion/constants.js";
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
  menuAriaLabel?: string;
}

export const DropdownMenuItem = ({ children, className = "", ...props }: JSX.HTMLAttributes<HTMLButtonElement> & { children?: ComponentChildren }) => {
  return (
    <button role="menuitem" data-dropdown-item="true" className={className} {...props}>
      {children}
    </button>
  );
};

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
  menuAriaLabel,
}: DropdownMenuProps) => {
  const isReducedMotion = useReducedMotion();
  const gsapTokens = useGsapInteractionTokens();
  const [isRendered, setIsRendered] = useState(false);
  const lastInteractionType = useRef<string | null>(null);
  const localTriggerRef = useRef<HTMLDivElement>(null);
  const triggerRef = externalTriggerRef || localTriggerRef;
  const menuRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const [transformOrigin, setTransformOrigin] = useState<string>("top center");

  // Generate a unique ID for ARIA wiring if none exists
  const [menuId] = useState(() => `menu-${Math.random().toString(36).substr(2, 9)}`);
  const [triggerId] = useState(() => `trigger-${Math.random().toString(36).substr(2, 9)}`);

  const enhanceContent = (node: ComponentChildren): ComponentChildren => {
    return toChildArray(node).map((child) => {
      if (!isValidElement(child)) return child;

      const vnode = child as VNode<any>;

      if (vnode.props && vnode.props.role === "menuitem") {
        return cloneElement(vnode, {
          "data-dropdown-item": "true"
        });
      }

      if (vnode.props && vnode.props.children) {
        return cloneElement(vnode, {
          ...vnode.props,
          children: enhanceContent(vnode.props.children)
        });
      }

      return child;
    });
  };

  const enhancedContent = enhanceContent(content);

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
      const itemCount = menuRef.current?.querySelectorAll('[data-dropdown-item]').length || 0;

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

      if (!isReducedMotion && itemCount > 0) {
        gsap.fromTo(
          menuRef.current?.querySelectorAll('[data-dropdown-item]') || [],
          { opacity: 0, y: 4 },
          {
            opacity: 1,
            y: 0,
            stagger: Math.min(0.018, 0.18 / itemCount),
            duration: 0.12,
            ease: "power2.out",
            delay: gsapTokens.enterExit.duration,
          }
        );
      }

      requestAnimationFrame(() => {
        const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled]):not([aria-disabled="true"])') || []);
        if (items.length > 0) {
          if (lastInteractionType.current === 'ArrowUp') {
            items[items.length - 1]?.focus({ preventScroll: true });
          } else {
            items[0]?.focus({ preventScroll: true });
          }
        }
        lastInteractionType.current = null;
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
      {isValidElement(children) ? cloneElement(children as preact.VNode<any>, {
        id: (children.props as any).id || triggerId,
        ref: (node: any) => {
          if (externalTriggerRef) {
            if (typeof externalTriggerRef === 'function') (externalTriggerRef as any)(node);
            else (externalTriggerRef as any).current = node;
          } else {
            (localTriggerRef as any).current = node;
          }
          const childRef = (children as any).ref;
          if (childRef) {
            if (typeof childRef === 'function') childRef(node);
            else childRef.current = node;
          }
        },
        onClick: (e: MouseEvent) => {
          lastInteractionType.current = 'click';
          e.stopPropagation();
          if (!(children.props as any).disabled) {
            onOpenChange(!isOpen);
          }
          if ((children.props as any).onClick) (children.props as any).onClick(e);
        },
        onKeyDown: (e: KeyboardEvent) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
            lastInteractionType.current = e.key;
            if (e.key !== 'Enter' && e.key !== ' ') {
                e.preventDefault();
                if (!(children.props as any).disabled) {
                  onOpenChange(true);
                }
            } else if (!externalTriggerRef) {
                e.preventDefault();
                if (!(children.props as any).disabled) {
                  onOpenChange(!isOpen);
                }
            }
          }
          if ((children.props as any).onKeyDown) (children.props as any).onKeyDown(e);
        },
        disabled: (children.props as any).disabled,
        "aria-label": (children.props as any)["aria-label"],
        "aria-haspopup": "menu",
        "aria-expanded": isOpen,
        "aria-controls": isOpen ? menuId : undefined,
      }) : (
        <button
          type="button"
          id={triggerId}
          ref={externalTriggerRef ? undefined : (localTriggerRef as unknown as RefObject<HTMLButtonElement>)}
          className="inline-flex cursor-pointer text-left"
          onClick={(e) => {
            lastInteractionType.current = 'click';
            e.stopPropagation();
            onOpenChange(!isOpen);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
              lastInteractionType.current = e.key;
              if (e.key !== 'Enter' && e.key !== ' ') {
                e.preventDefault();
                onOpenChange(true);
              } else if (!externalTriggerRef) {
                e.preventDefault();
                onOpenChange(!isOpen);
              }
            }
          }}
          aria-haspopup="menu"
          aria-expanded={isOpen}
          aria-controls={isOpen ? menuId : undefined}
        >
          {children}
        </button>
      )}

      {isRendered && typeof document !== "undefined" &&
        createPortal(
          <div
            id={menuId}
            ref={menuRef}
            role="menu"
            aria-label={menuAriaLabel}
            aria-labelledby={menuAriaLabel ? undefined : (isValidElement(children) && (children.props as any).id ? (children.props as any).id : triggerId)}
            className={`fixed z-[100] bg-white dark:bg-void-800 border border-black/[0.08] dark:border-white/[0.08] shadow-[0_16px_36px_rgba(15,23,42,0.14)] dark:shadow-[0_16px_36px_rgba(0,0,0,0.4)] rounded-2xl p-2 ${!isOpen ? "pointer-events-none" : ""} ${className}`}
            style={{ top: coords.top, left: coords.left, transformOrigin }}
            onClick={(e) => e.stopPropagation()}
          >
            {enhancedContent}
          </div>,
          document.body
        )}
    </>
  );
};
