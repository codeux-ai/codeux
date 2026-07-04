import type { FunctionComponent, ComponentChildren } from "preact";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useMemo } from "preact/hooks";
import { createPortal } from "preact/compat";
import { Check, ChevronDown } from "lucide-preact";
import gsap from "gsap";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { useGsapDurations, GSAP_EASINGS } from "../../lib/motion/constants.js";
import { useInteractionTokens } from "../../lib/motion/tokens.js";

export interface SelectOption {
  value: string;
  label: string;
  icon?: ComponentChildren | (() => ComponentChildren);
  description?: ComponentChildren;
  meta?: ComponentChildren;
  disabled?: boolean;
  unavailableReason?: ComponentChildren;
}

interface AvantgardeSelectProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  disabled?: boolean;
  placeholder?: string;
  /** Compact variant for inline/card usage (smaller text, no border bg) */
  variant?: "default" | "compact" | "card";
  className?: string;
  searchable?: boolean;
  /** When searchable, offers a synthetic "Use "<typed text>"" option if nothing matches, committing the raw typed value via onChange. */
  allowCustomValue?: boolean;
  /** Caps how many matching options are rendered (after filtering), so a large option set never dumps thousands of rows into the DOM. Search still matches against the full list. */
  maxVisibleOptions?: number;
  invalid?: boolean;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "false" | "true" | "grammar" | "spelling";
  "aria-errormessage"?: string;
  "aria-required"?: boolean | "false" | "true";
  onBlur?: (e: FocusEvent) => void;
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
  id,
  value,
  onChange,
  options,
  disabled = false,
  placeholder = "Select\u2026",
  variant = "default",
  className = "",
  searchable = false,
  allowCustomValue = false,
  maxVisibleOptions,
  invalid = false,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledby,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  "aria-errormessage": ariaErrorMessage,
  "aria-required": ariaRequired,
  onBlur,
}) => {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [isRendered, setIsRendered] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [position, setPosition] = useState<DropdownPosition | null>(null);
  const reducedMotion = useReducedMotion();
  const tokens = useInteractionTokens();
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


  // Focus once per open (not on every reposition from scroll/resize, which would otherwise
  // steal focus back from the search input mid-typing). Searchable selects focus the search
  // input directly so typing can start immediately; non-searchable ones focus the listbox for
  // keyboard nav.
  useEffect(() => {
    if (!open || !isRendered) {
      return;
    }
    if (searchable) {
      focusWithoutScroll(searchInputRef.current);
    } else {
      focusWithoutScroll(listboxRef.current);
    }
  }, [open, isRendered, searchable]);


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
    const cap = (list: SelectOption[]) => (
      maxVisibleOptions !== undefined && list.length > maxVisibleOptions
        ? list.slice(0, maxVisibleOptions)
        : list
    );

    if (!searchable || !filter.trim()) return cap(options);
    const trimmed = filter.trim();
    const lowerFilter = trimmed.toLowerCase();
    const matches = cap(options.filter(o => o.label.toLowerCase().includes(lowerFilter)));
    if (!allowCustomValue) return matches;
    const hasExactMatch = options.some(o => o.value.toLowerCase() === lowerFilter || o.label.toLowerCase() === lowerFilter);
    if (hasExactMatch) return matches;
    return [...matches, { value: trimmed, label: `Use "${trimmed}"` }];
  }, [options, searchable, allowCustomValue, filter, maxVisibleOptions]);

  const enabledFilteredOptions = filteredOptions.filter((option) => !option.disabled);

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
    if (!enabledFilteredOptions.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex(prev => {
        for (let offset = 1; offset <= filteredOptions.length; offset += 1) {
          const next = (prev + offset + filteredOptions.length) % filteredOptions.length;
          if (!filteredOptions[next]?.disabled) return next;
        }
        return prev;
      });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex(prev => {
        for (let offset = 1; offset <= filteredOptions.length; offset += 1) {
          const next = (prev - offset + filteredOptions.length) % filteredOptions.length;
          if (!filteredOptions[next]?.disabled) return next;
        }
        return prev;
      });
    } else if (e.key === "Home") {
      e.preventDefault();
      setActiveIndex(filteredOptions.findIndex((option) => !option.disabled));
    } else if (e.key === "End") {
      e.preventDefault();
      setActiveIndex(Math.max(0, filteredOptions.map((option, index) => option.disabled ? -1 : index).filter((index) => index >= 0).pop() ?? 0));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < filteredOptions.length && !filteredOptions[activeIndex].disabled) {
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
      ? `flex min-h-8 w-full min-w-0 items-center justify-between gap-2 bg-transparent py-1 text-[11px] font-bold uppercase tracking-[0.14em] outline-none focus-visible:ring-2 focus-visible:ring-signal-500/20 ${
          disabled
            ? "cursor-not-allowed text-slate-400"
            : "cursor-pointer text-signal-600 hover:text-signal-500 dark:text-signal-300 dark:hover:text-signal-200"
        }`
      : variant === "card"
        ? `flex min-h-10 w-full min-w-0 items-center justify-between gap-2 rounded-[var(--radius-ui)] border bg-[var(--fill-muted)] px-3.5 py-2.5 text-[11px] font-bold uppercase tracking-[0.14em] shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] outline-none focus:border-signal-500/40 focus-visible:ring-2 focus-visible:ring-[var(--accent-focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-void-900 ${
            disabled
              ? "cursor-not-allowed border-[color:var(--border-hairline)] text-slate-400 opacity-60"
              : `cursor-pointer text-signal-600 dark:text-signal-300 ${open ? 'border-signal-500/40' : 'border-[color:var(--border-hairline)] hover:border-black/[0.1] hover:bg-[var(--fill-muted-hover)] dark:hover:border-white/[0.12]'}`
          }`
        : `flex min-h-10 w-full min-w-0 items-center justify-between gap-2.5 rounded-[var(--radius-ui)] border px-3.5 py-2.5 text-sm font-medium leading-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] outline-none focus:border-signal-500/40 focus-visible:ring-2 focus-visible:ring-[var(--accent-focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-void-900 ${
            disabled
              ? "cursor-not-allowed border-[color:var(--border-hairline)] bg-[var(--fill-muted)] text-slate-400 opacity-60"
              : `cursor-pointer bg-[var(--fill-muted)] text-slate-800 backdrop-blur-xl hover:bg-[var(--fill-muted-hover)] dark:text-slate-100 ${open ? 'border-signal-500/40' : 'border-[color:var(--border-hairline)] hover:border-black/[0.1] dark:hover:border-white/[0.12]'}`
          }`;

  const finalTriggerClass = `${triggerClass} ${invalid ? '!border-status-red/60 !bg-status-red/[0.04] !text-status-red shadow-[0_0_0_1px_rgba(211,47,47,0.16)]' : ''} ${invalid && !reducedMotion ? 'animate-form-shake' : ''}`;

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
          className={`overflow-hidden rounded-[var(--radius-ui)] border border-[color:var(--border-hairline)] bg-white/[0.97] shadow-[var(--elevation-floating)] backdrop-blur-2xl dark:bg-void-800/[0.97] ${
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
                className="min-h-9 w-full rounded-[var(--radius-ui)] border border-[color:var(--border-hairline)] bg-[var(--fill-muted)] px-3 py-1.5 text-sm text-slate-700 outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-[var(--accent-focus-ring)] dark:text-slate-200"
                  ref={searchInputRef}
                />
              </div>
            )}
            {filteredOptions.map((option, idx) => {
              const isSelected = option.value === value;
              const isFocused = idx === activeIndex;
              const isUnavailable = !!option.disabled;
              return (
                <button
                  key={option.value}
                  id={`select-option-${option.value.replace(/\W/g, '-')}`}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={isUnavailable}
                  type="button"
                  ref={isFocused ? activeOptionRef : null}
                  onClick={() => {
                    if (isUnavailable) return;
                    onChange(option.value);
                    setOpen(false);
                    focusWithoutScroll(triggerRef.current);
                  }}
                  className={`flex min-h-11 w-full min-w-0 items-start gap-2.5 px-3.5 py-2.5 text-left text-sm transition-colors ${
                    isUnavailable ? "cursor-not-allowed opacity-55" : "cursor-pointer"
                  } ${
                    isFocused && !isUnavailable ? "bg-signal-500/10 shadow-[inset_2px_0_0_0_var(--color-signal-500)] text-signal-600 dark:text-signal-300 z-10 relative" : ""
                  }${
                    isSelected
                      ? "bg-signal-500/[0.08] font-semibold text-signal-700 dark:text-signal-300"
                      : "text-slate-700 hover:bg-black/[0.04] dark:text-slate-300 dark:hover:bg-white/[0.05]"
                  }`}
                >
                  {option.icon && <span className="mt-0.5 flex-shrink-0">{renderOptionIcon(option.icon)}</span>}
                  <span className="min-w-0 flex-1">
                    <span className="block min-w-0 break-words leading-5">{option.label}</span>
                    {option.description ? (
                      <span className="mt-0.5 block min-w-0 break-words text-xs font-medium leading-relaxed text-[var(--text-metadata)]">{option.description}</span>
                    ) : null}
                    {option.meta || option.unavailableReason ? (
                      <span className={`mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-semibold leading-4 ${option.unavailableReason ? "text-status-red" : "text-[var(--text-metadata)]"}`}>
                        {option.meta}
                        {option.unavailableReason ? <span>{option.unavailableReason}</span> : null}
                      </span>
                    ) : null}
                  </span>
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
        id={id}
        ref={triggerRef}
        style={{ transitionProperty: "all", transitionDuration: tokens.controlFeedback.duration, transitionTimingFunction: tokens.controlFeedback.ease }}
        type="button"
        onClick={() => !disabled && setOpen(!open)}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === " ")) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        onBlur={onBlur}
        className={finalTriggerClass}
        disabled={disabled}
        aria-invalid={ariaInvalid !== undefined ? ariaInvalid : (invalid ? "true" : "false")}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledby}
        aria-describedby={ariaDescribedBy}
        aria-errormessage={ariaErrorMessage}
        aria-required={ariaRequired}
      >
        {selected?.icon ? <span className="flex-shrink-0">{renderOptionIcon(selected.icon)}</span> : null}
        <span className="min-w-0 flex-1 truncate text-left">{selected?.label || placeholder}</span>
        <ChevronDown
          style={{ transitionProperty: "transform", transitionDuration: tokens.controlFeedback.duration, transitionTimingFunction: tokens.controlFeedback.ease }}
          className={`h-3.5 w-3.5 flex-shrink-0 text-slate-400 transition-transform  ${open ? "rotate-180" : ""}`}
          strokeWidth={2}
        />
      </button>
      {panel}
    </div>
  );
};
