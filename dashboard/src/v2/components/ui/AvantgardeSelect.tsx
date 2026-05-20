import type { FunctionComponent, ComponentChildren } from "preact";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useMemo } from "preact/hooks";
import { createPortal } from "preact/compat";
import { Check, ChevronDown } from "lucide-preact";
import gsap from "gsap";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { useGsapDurations, GSAP_EASINGS } from "../../lib/motion/constants.js";

export interface SelectOption {
  value: string;
  label: string;
  icon?: ComponentChildren | (() => ComponentChildren);
}

interface AvantgardeSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  disabled?: boolean;
  placeholder?: string;
  /** Compact variant for inline/card usage (smaller text, no border bg) */
  variant?: "default" | "compact" | "card";
  className?: string;
  searchable?: boolean;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}

interface DropdownPosition {
  top: number;
  left: number;
  width: number;
  direction: "down" | "up";
}

function focusWithoutScroll(element: HTMLElement | null): void {
  if (!element) {
    return;
  }
  try {
    element.focus({ preventScroll: true });
  } catch {
    element.focus();
  }
}

function renderOptionIcon(icon: SelectOption["icon"]): ComponentChildren {
  return typeof icon === "function" ? icon() : icon;
}

/** Walk up the DOM to find the nearest ancestor that acts as a visual boundary
 *  (has overflow clipping, a border-radius card, or is a dialog/modal). */
function findBoundaryAncestor(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement;
  while (node && node !== document.body) {
    const style = getComputedStyle(node);
    const overflow = style.overflow + style.overflowX + style.overflowY;
    const isClipping = /hidden|auto|scroll/.test(overflow);
    const hasBorderRadius = parseFloat(style.borderRadius) > 8;
    const isDialog = node.tagName === "DIALOG" || node.getAttribute("role") === "dialog";
    if ((isClipping && hasBorderRadius) || isDialog) return node;
    node = node.parentElement;
  }
  return null;
}

export const AvantgardeSelect: FunctionComponent<AvantgardeSelectProps> = ({
  value,
  onChange,
  options,
  disabled = false,
  placeholder = "Select\u2026",
  variant = "default",
  className = "",
  searchable = false,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledby,
}) => {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [isRendered, setIsRendered] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<DropdownPosition | null>(null);
  const reducedMotion = useReducedMotion();
  const durations = useGsapDurations();

  const updatePosition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;

    const triggerRect = el.getBoundingClientRect();
    const panelWidth = Math.max(triggerRect.width, 180);
    const GAP = 6;
    const PANEL_MAX_H = 272; // matches max-h-[17rem]
    const EDGE_MARGIN = 8;

    // Find boundary (card / modal / viewport)
    const boundary = findBoundaryAncestor(el);
    const bounds = boundary
      ? boundary.getBoundingClientRect()
      : { top: 0, left: 0, right: window.innerWidth, bottom: window.innerHeight };

    // --- Vertical direction ---
    const spaceBelow = bounds.bottom - triggerRect.bottom - GAP - EDGE_MARGIN;
    const spaceAbove = triggerRect.top - bounds.top - GAP - EDGE_MARGIN;
    const direction: "down" | "up" =
      spaceBelow >= PANEL_MAX_H || spaceBelow >= spaceAbove ? "down" : "up";

    const top =
      direction === "down"
        ? triggerRect.bottom + GAP
        : triggerRect.top - GAP;

    // --- Horizontal: keep panel within bounds ---
    let left = triggerRect.left;
    const panelRight = left + panelWidth;
    const boundsRight = bounds.right;
    const boundsLeft = bounds.left;

    if (panelRight > boundsRight - EDGE_MARGIN) {
      // Align right edge of panel with right edge of trigger (or boundary)
      left = Math.max(boundsLeft + EDGE_MARGIN, triggerRect.right - panelWidth);
    }
    if (left < boundsLeft + EDGE_MARGIN) {
      left = boundsLeft + EDGE_MARGIN;
    }

    setPosition({ top, left, width: panelWidth, direction });
  }, []);

  // Reposition on open, scroll, resize
  useLayoutEffect(() => {
    if (!open) {
      // Delay position nullification until exit animation finishes (managed via isRendered later)
      return;
    }
    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (open) {
      setIsRendered(true);
    }
  }, [open]);

  useEffect(() => {
    if (!isRendered) {
      setPosition(null);
    }
  }, [isRendered]);

  useLayoutEffect(() => {
    if (!isRendered || !panelRef.current || !position) return;

    const panel = panelRef.current;
    let ctx = gsap.context(() => {
      const isUp = position.direction === "up";
      const initialY = isUp ? "calc(-100% + 10px)" : "-10px";
      const targetY = isUp ? "-100%" : "0px";

      // Check if gsap is mocked or unavailable in test environment
      if (typeof gsap.fromTo !== 'function' || typeof gsap.to !== 'function') {
        if (!open) setIsRendered(false);
        return;
      }

      if (open) {
        gsap.fromTo(panel,
          { opacity: 0, y: initialY, scale: 0.98, filter: "blur(4px)" },
          {
            opacity: 1,
            y: targetY,
            scale: 1,
            filter: "blur(0px)",
            duration: durations.base,
            ease: GSAP_EASINGS.smooth,
            clearProps: "filter"
          }
        );
      } else {
        gsap.to(panel, {
          opacity: 0,
          y: initialY,
          scale: 0.98,
          filter: "blur(4px)",
          duration: durations.fast,
          ease: GSAP_EASINGS.smoothInOut,
          onComplete: () => {
            setIsRendered(false);
          }
        });
      }
    }, panel);

    return () => ctx.revert();
  }, [open, isRendered, position?.direction, reducedMotion]);

  useEffect(() => {
    if (open) {
      const idx = options.findIndex(o => o.value === value);
      setActiveIndex(idx >= 0 ? idx : 0);
    } else {
      setActiveIndex(-1);
      setFilter("");
    }
  }, [open, value, options]);


  useEffect(() => {
    if (open && listboxRef.current) {
      focusWithoutScroll(listboxRef.current);
    }
  }, [open, position]);


  // Click outside
  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        panelRef.current?.contains(target)
      ) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);



  const filteredOptions = useMemo(() => {
    if (!searchable || !filter.trim()) return options;
    const lowerFilter = filter.toLowerCase();
    return options.filter(o => o.label.toLowerCase().includes(lowerFilter));
  }, [options, searchable, filter]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (!open) return;
    // Don't intercept space if we are in the search input
    if (e.key === " " && (e.target as HTMLElement).tagName === "INPUT") {
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      focusWithoutScroll(triggerRef.current);
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      setOpen(false);
      focusWithoutScroll(triggerRef.current);
      return;
    }
    if (!filteredOptions.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex(prev => (prev + 1) % filteredOptions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex(prev => (prev - 1 + filteredOptions.length) % filteredOptions.length);
    } else if (e.key === "Home") {
      e.preventDefault();
      setActiveIndex(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActiveIndex(filteredOptions.length - 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < filteredOptions.length) {
        onChange(filteredOptions[activeIndex].value);
        setOpen(false);
        focusWithoutScroll(triggerRef.current);
      }
    }
  };

  const selected = options.find((o) => o.value === value);

  const activeOptionRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const listbox = listboxRef.current;
    const activeOption = activeOptionRef.current;
    if (open && listbox && activeOption) {
      const optionTop = activeOption.offsetTop;
      const optionBottom = optionTop + activeOption.offsetHeight;
      const visibleTop = listbox.scrollTop;
      const visibleBottom = visibleTop + listbox.clientHeight;
      if (optionTop < visibleTop) {
        listbox.scrollTop = optionTop;
      } else if (optionBottom > visibleBottom) {
        listbox.scrollTop = optionBottom - listbox.clientHeight;
      }
    }
  }, [activeIndex, open]);


  const triggerClass =
    variant === "compact"
      ? `flex w-full items-center justify-between gap-2 bg-transparent py-1 text-[11px] font-bold uppercase tracking-[0.14em] outline-none focus-visible:ring-2 focus-visible:ring-signal-500/20 transition-colors ${
          disabled
            ? "cursor-not-allowed text-slate-400"
            : "cursor-pointer text-signal-600 hover:text-signal-500 dark:text-signal-300 dark:hover:text-signal-200"
        }`
      : variant === "card"
        ? `flex w-full items-center justify-between gap-2 rounded-[1.2rem] border bg-white/66 px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.14em] outline-none focus:border-signal-500/30 focus-visible:ring-2 focus-visible:ring-signal-500/20 transition-all ${
            disabled
              ? "cursor-not-allowed border-black/[0.06] text-slate-400 opacity-60"
              : `cursor-pointer text-signal-600 dark:bg-white/[0.02] dark:text-signal-300 ${open ? 'border-signal-500/30 dark:border-signal-500/30' : 'border-black/[0.06] hover:border-black/[0.1] dark:border-white/[0.06] dark:hover:border-white/[0.1]'}`
          }`
        : `flex w-full items-center justify-between gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm font-medium outline-none focus:border-signal-500/30 focus-visible:ring-2 focus-visible:ring-signal-500/20 transition-all ${
            disabled
              ? "cursor-not-allowed border-black/[0.04] bg-black/[0.02] text-slate-400 opacity-60 dark:border-white/[0.04] dark:bg-white/[0.02]"
              : `cursor-pointer bg-white/52 text-slate-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.72),0_10px_24px_rgba(15,23,42,0.04)] backdrop-blur-xl dark:bg-white/[0.045] dark:text-slate-100 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_10px_24px_rgba(0,0,0,0.18)] ${open ? 'border-signal-500/30 dark:border-signal-500/30' : 'border-black/[0.06] hover:border-black/[0.12] dark:border-white/[0.06] dark:hover:border-white/[0.12]'}`
          }`;
  const panel = isRendered && position
    ? createPortal(
        <div
          ref={panelRef}
          style={{
            position: "fixed",
            left: `${position.left}px`,
            top: `${position.top}px`,
            width: `${position.width}px`,
            zIndex: 9999,
          }}
          className={`overflow-hidden rounded-2xl border border-black/[0.06] bg-white/[0.97] shadow-[0_20px_40px_rgba(0,0,0,0.12),0_0_0_1px_rgba(0,0,0,0.03)] backdrop-blur-2xl dark:border-white/[0.08] dark:bg-void-800/[0.97] dark:shadow-[0_20px_40px_rgba(0,0,0,0.4),0_0_0_1px_rgba(255,255,255,0.04)] ${
            position.direction === "up" ? "origin-bottom" : "origin-top"
          }`}
        >
          <div
            ref={listboxRef}
            tabIndex={-1}
            className="max-h-[17rem] overflow-y-auto overscroll-contain py-1.5 outline-none dropdown-scrollbar"
            role="listbox"
            onKeyDown={onKeyDown}
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledby}
            aria-activedescendant={activeIndex >= 0 && filteredOptions[activeIndex] ? `select-option-${filteredOptions[activeIndex].value.replace(/\W/g, '-')}` : undefined}
          >
            {searchable && (
              <div className="px-2 pt-1 pb-1.5 sticky -top-1.5 bg-white/[0.97] dark:bg-void-800/[0.97] z-20">
                <input
                  type="text"
                  placeholder="Search..."
                  value={filter}
                  onInput={(e) => {
                    setFilter(e.currentTarget.value);
                    setActiveIndex(0);
                  }}
                  onKeyDown={onKeyDown as any}
                  className="w-full px-3 py-1.5 bg-black/[0.04] dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.06] rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-signal-500/30 text-slate-700 dark:text-slate-200"
                  ref={(el) => { if (el && open) focusWithoutScroll(el); }}
                />
              </div>
            )}
            {filteredOptions.map((option, idx) => {
              const isSelected = option.value === value;
              const isFocused = idx === activeIndex;
              return (
                <button
                  key={option.value}
                  id={`select-option-${option.value.replace(/\W/g, '-')}`}
                  role="option"
                  aria-selected={isSelected}
                  type="button"
                  ref={isFocused ? activeOptionRef : null}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                    focusWithoutScroll(triggerRef.current);
                  }}
                  className={`flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm transition-colors ${
                    isFocused ? "bg-signal-500/10 shadow-[inset_2px_0_0_0_var(--color-signal-500)] text-signal-600 dark:text-signal-300 z-10 relative" : ""
                  }${
                    isSelected
                      ? "bg-signal-50/50 dark:bg-signal-900/20 font-semibold text-signal-700 dark:text-signal-300"
                      : "text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-void-700"
                  }`}
                >
                  {option.icon && <span className="flex-shrink-0">{renderOptionIcon(option.icon)}</span>}
                  <span className="truncate">{option.label}</span>
                  {isSelected && (
                    <Check className="ml-auto h-3.5 w-3.5 flex-shrink-0 text-signal-500" strokeWidth={2.5} />
                  )}
                </button>
              );
            })}
            {filteredOptions.length === 0 && (
              <div className="px-3.5 py-4 text-xs font-medium text-slate-400">No options available.</div>
            )}
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <div className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => !disabled && setOpen(!open)}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === " ")) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={triggerClass}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledby}
      >
        {selected?.icon ? <span className="flex-shrink-0">{renderOptionIcon(selected.icon)}</span> : null}
        <span className="truncate">{selected?.label || placeholder}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 flex-shrink-0 text-slate-400 transition-transform duration-300 ${open ? "rotate-180" : ""}`}
          strokeWidth={2}
        />
      </button>
      {panel}
    </div>
  );
};
