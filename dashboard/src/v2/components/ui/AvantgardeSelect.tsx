import type { FunctionComponent, ComponentChildren } from "preact";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "preact/hooks";
import { createPortal } from "preact/compat";
import { Check, ChevronDown } from "lucide-preact";

export interface SelectOption {
  value: string;
  label: string;
  icon?: ComponentChildren;
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
}

interface DropdownPosition {
  top: number;
  left: number;
  width: number;
  direction: "down" | "up";
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
}) => {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<DropdownPosition | null>(null);
  const listboxId = useId();

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
        ? triggerRect.bottom + GAP + window.scrollY
        : triggerRect.top - GAP + window.scrollY;

    // --- Horizontal: keep panel within bounds ---
    let left = triggerRect.left + window.scrollX;
    const panelRight = left + panelWidth;
    const boundsRight = bounds.right + window.scrollX;
    const boundsLeft = bounds.left + window.scrollX;

    if (panelRight > boundsRight - EDGE_MARGIN) {
      // Align right edge of panel with right edge of trigger (or boundary)
      left = Math.max(boundsLeft + EDGE_MARGIN, triggerRect.right + window.scrollX - panelWidth);
    }
    if (left < boundsLeft + EDGE_MARGIN) {
      left = boundsLeft + EDGE_MARGIN;
    }

    setPosition({ top, left, width: panelWidth, direction });
  }, []);

  // Reposition on open, scroll, resize
  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
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

  // Escape key
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const selected = options.find((o) => o.value === value);

  const triggerClass =
    variant === "compact"
      ? `flex w-full items-center justify-between gap-2 bg-transparent py-1 text-[11px] font-bold uppercase tracking-[0.14em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 transition-colors ${
          disabled
            ? "cursor-not-allowed text-slate-400"
            : "cursor-pointer text-signal-600 hover:text-signal-500 dark:text-signal-300 dark:hover:text-signal-200"
        }`
      : variant === "card"
        ? `flex w-full items-center justify-between gap-2 rounded-[1.2rem] border border-black/[0.06] bg-white/66 px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.14em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 transition-all ${
            disabled
              ? "cursor-not-allowed text-slate-400 opacity-60"
              : "cursor-pointer text-signal-600 hover:border-black/[0.1] dark:border-white/[0.06] dark:bg-white/[0.02] dark:text-signal-300 dark:hover:border-white/[0.1]"
          }`
        : `flex w-full items-center justify-between gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 transition-all ${
            disabled
              ? "cursor-not-allowed border-black/[0.04] bg-black/[0.02] text-slate-400 opacity-60 dark:border-white/[0.04] dark:bg-white/[0.02]"
              : "cursor-pointer border-black/[0.07] bg-white/52 text-slate-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.72),0_10px_24px_rgba(15,23,42,0.04)] backdrop-blur-xl hover:border-black/[0.12] dark:border-white/[0.08] dark:bg-white/[0.045] dark:text-slate-100 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_10px_24px_rgba(0,0,0,0.18)] dark:hover:border-white/[0.12]"
          }`;

  const panel = open && position
    ? createPortal(
        <div
          id={listboxId}
          role="listbox"
          ref={panelRef}
          style={{
            position: "absolute",
            left: `${position.left}px`,
            ...(position.direction === "down"
              ? { top: `${position.top}px` }
              : { top: `${position.top}px`, transform: "translateY(-100%)" }),
            width: `${position.width}px`,
            zIndex: 9999,
          }}
          className="overflow-hidden rounded-2xl border border-black/[0.06] bg-white/[0.97] shadow-[0_20px_40px_rgba(0,0,0,0.12),0_0_0_1px_rgba(0,0,0,0.03)] backdrop-blur-2xl dark:border-white/[0.08] dark:bg-void-800/[0.97] dark:shadow-[0_20px_40px_rgba(0,0,0,0.4),0_0_0_1px_rgba(255,255,255,0.04)]"
        >
          <div className="max-h-[17rem] overflow-y-auto overscroll-contain py-1.5">
            {options.map((option) => {
              const isActive = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  className={`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm transition-colors ${
                    isActive
                      ? "bg-signal-500/8 font-semibold text-signal-600 dark:text-signal-400"
                      : "text-slate-700 hover:bg-signal-500/5 dark:text-slate-300 dark:hover:bg-signal-500/5"
                  }`}
                >
                  {option.icon && <span className="flex-shrink-0">{option.icon}</span>}
                  <span className="truncate">{option.label}</span>
                  {isActive && (
                    <Check className="ml-auto h-3.5 w-3.5 flex-shrink-0 text-signal-500" strokeWidth={2.5} />
                  )}
                </button>
              );
            })}
            {options.length === 0 && (
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
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        className={triggerClass}
        disabled={disabled}
      >
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
