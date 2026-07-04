import type { FunctionComponent } from "preact";
import { useState, useRef, useEffect, useLayoutEffect } from "preact/hooks";
import { useInteractionTokens } from "../../lib/motion/tokens.js";
import { useGsapInteractionTokens } from "../../lib/motion/constants.js";
import { gsap } from "gsap";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { X } from "lucide-preact";

export interface Option {
  value: string;
  label: string;
}

interface MultiSelectProps {
  id?: string;
  options?: Option[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  className?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "false" | "true" | "grammar" | "spelling";
  "aria-errormessage"?: string;
  "aria-required"?: boolean | "false" | "true";
  onBlur?: (e: FocusEvent) => void;
}

const MULTI_SELECT_SHELL_CLASS =
  "flex min-h-10 w-full min-w-0 flex-wrap items-center gap-1.5 rounded-[var(--radius-ui)] border border-[color:var(--border-hairline)] bg-[var(--fill-muted)] px-3 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] transition-all hover:border-black/[0.1] hover:bg-[var(--fill-muted-hover)] focus-within:border-signal-500/50 focus-within:ring-2 focus-within:ring-[var(--accent-focus-ring)] focus-within:ring-offset-2 focus-within:ring-offset-white dark:hover:border-white/[0.12] dark:focus-within:ring-offset-void-900";

export const MultiSelect: FunctionComponent<MultiSelectProps> = ({
  id,
  options = [],
  value,
  onChange,
  placeholder = "Add label...",
  className = "",
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  "aria-errormessage": ariaErrorMessage,
  "aria-required": ariaRequired,
  onBlur,
}) => {
  const [inputValue, setInputValue] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const [listboxId] = useState(() => 'ms-' + Math.random().toString(36).slice(2, 7));
  const tokens = useInteractionTokens();
  const gsapTokens = useGsapInteractionTokens();
  const isReducedMotion = useReducedMotion();


  useLayoutEffect(() => {
    if (isOpen && listboxRef.current && !isReducedMotion) {
      gsap.fromTo(listboxRef.current, { opacity: 0, y: -4 }, { opacity: 1, y: 0, duration: gsapTokens.listReveal.duration, ease: gsapTokens.listReveal.ease });
    }
  }, [isOpen, isReducedMotion, gsapTokens.listReveal]);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const addTag = (tag: string) => {
    const trimmed = tag.trim();
    if (trimmed && !value.includes(trimmed)) {
      onChange([...value, trimmed]);
    }
    setInputValue("");
  };

  const removeTag = (tagToRemove: string) => {
    onChange(value.filter((tag) => tag !== tagToRemove));
  };

  const toggleOption = (optionValue: string) => {
    const newValue = value.includes(optionValue)
      ? value.filter((v) => v !== optionValue)
      : [...value, optionValue];
    onChange(newValue);
  };

  const filteredOptions = options.filter(opt =>
    opt.label.toLowerCase().includes(inputValue.toLowerCase()) ||
    opt.value.toLowerCase().includes(inputValue.toLowerCase())
  );

  const getFocusedIndex = () => {
    if (!listboxRef.current) return -1;
    const items = Array.from(listboxRef.current.querySelectorAll('[role="option"]')) as HTMLElement[];
    return items.findIndex(item => item === document.activeElement);
  };

  const focusOption = (index: number) => {
    if (!listboxRef.current) return;
    const items = Array.from(listboxRef.current.querySelectorAll('[role="option"]')) as HTMLElement[];
    if (items[index]) {
      items[index].focus();
    }
  };

  const handleInputKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(inputValue);
    } else if (e.key === "Backspace" && inputValue === "" && value.length > 0) {
      removeTag(value[value.length - 1]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        // Focus first option after render
        setTimeout(() => focusOption(0), 0);
      } else {
        focusOption(0);
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        // Focus last option after render
        setTimeout(() => focusOption(filteredOptions.length - 1), 0);
      } else {
        focusOption(filteredOptions.length - 1);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setIsOpen(false);
    }
  };

  const handleListboxKeyDown = (e: KeyboardEvent) => {
    const currentIndex = getFocusedIndex();

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (currentIndex < filteredOptions.length - 1) {
        focusOption(currentIndex + 1);
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (currentIndex > 0) {
        focusOption(currentIndex - 1);
      } else {
        inputRef.current?.focus();
      }
    } else if (e.key === "Home") {
      e.preventDefault();
      focusOption(0);
    } else if (e.key === "End") {
      e.preventDefault();
      focusOption(filteredOptions.length - 1);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setIsOpen(false);
      inputRef.current?.focus();
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (currentIndex >= 0 && currentIndex < filteredOptions.length) {
        toggleOption(filteredOptions[currentIndex].value);
      }
    }
  };

  const handleBlur = (e: FocusEvent) => {
    // If we're clicking inside the container (e.g. an option), don't add tag yet
    // The option click handler will do its job.
    // We can check relatedTarget to see if focus moved within the component.
    if (containerRef.current && containerRef.current.contains(e.relatedTarget as Node)) {
      return;
    }

    // Otherwise it's a real blur
    addTag(inputValue);
    onBlur?.(e);
  };

  return (
    <div className={`relative min-w-0 ${className}`} ref={containerRef}>
      <div
        className={`${MULTI_SELECT_SHELL_CLASS} ${ariaInvalid === 'true' || ariaInvalid === true ? '!border-status-red/60 bg-status-red/[0.04] shadow-[0_0_0_1px_rgba(211,47,47,0.16)]' : ''}`}
        onClick={() => {
          inputRef.current?.focus();
          setIsOpen(true);
        }}
      >
        {value.map((tag) => {
          const matchedOption = options.find(o => o.value === tag);
          const label = matchedOption ? matchedOption.label : tag;
          return (
            <span
              key={tag}
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-black/[0.06] bg-white/70 px-2 py-0.5 text-[11px] font-semibold leading-5 text-slate-700 dark:border-white/[0.08] dark:bg-white/[0.08] dark:text-slate-300"
            >
              <span className="min-w-0 truncate">{label}</span>
              <button
                type="button"
                style={{ transitionDuration: tokens.controlFeedback.duration, transitionTimingFunction: tokens.controlFeedback.ease }}
                onClick={(e) => {
                  e.stopPropagation();
                  removeTag(tag);
                }}
                className="shrink-0 rounded-full hover:text-status-red focus:outline-none focus-visible:ring-2 focus-visible:ring-status-red/30"
                aria-label={`Remove ${label}`}
              >
                <X className="h-3 w-3" strokeWidth={2.5} />
              </button>
            </span>
          );
        })}
        <input
          id={id}
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          aria-controls={listboxId}
          aria-describedby={ariaDescribedBy}
          aria-invalid={ariaInvalid}
          aria-errormessage={ariaErrorMessage}
          aria-required={ariaRequired}
          value={inputValue}
          onInput={(e) => {
            setInputValue((e.target as HTMLInputElement).value);
            setIsOpen(true);
          }}
          onKeyDown={handleInputKeyDown}
          onBlur={handleBlur}
          placeholder={value.length === 0 ? placeholder : ""}
          className="min-h-7 min-w-[7rem] flex-1 bg-transparent text-sm leading-5 text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-100"
        />
      </div>

      {isOpen && filteredOptions.length > 0 && (
        <div
          id={listboxId}
          role="listbox"
          ref={listboxRef}
          onKeyDown={handleListboxKeyDown}
          className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-[var(--radius-ui)] border border-[color:var(--border-hairline)] bg-white py-1.5 shadow-[var(--elevation-floating)] dark:bg-void-800"
        >
          {filteredOptions.map((option) => {
            const isSelected = value.includes(option.value);
            return (
              <div
                key={option.value}
                role="option"
                style={{ transitionDuration: tokens.controlFeedback.duration, transitionTimingFunction: tokens.controlFeedback.ease }}
                aria-selected={isSelected}
                tabIndex={-1}
                className={`flex min-h-9 cursor-pointer items-center gap-2 px-3 py-2 text-sm leading-5 hover:bg-black/[0.04] dark:hover:bg-white/[0.05] focus:bg-black/[0.04] dark:focus:bg-white/[0.05] focus:ring-1 focus:ring-inset focus:ring-signal-500/50 outline-none ${
                  isSelected ? "bg-signal-500/10 text-signal-700 dark:text-signal-400" : "text-slate-700 dark:text-slate-300"
                }`}
                onMouseDown={(e) => {
                  e.preventDefault(); // prevent blur of input if input had focus
                }}
                onClick={() => {
                  toggleOption(option.value);
                  inputRef.current?.focus();
                }}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  readOnly
                  tabIndex={-1}
                  className="h-3.5 w-3.5 shrink-0 rounded border-slate-300 text-signal-500 focus:ring-signal-500 dark:border-white/[0.18] dark:bg-transparent pointer-events-none"
                />
                <span className="min-w-0 break-words">{option.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
