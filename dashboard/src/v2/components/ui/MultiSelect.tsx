import type { FunctionComponent } from "preact";
import { useState, useRef, useEffect } from "preact/hooks";
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
    <div className={`relative ${className}`} ref={containerRef}>
      <div
        className={`flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-[0.95rem] border border-black/[0.06] bg-transparent px-3 py-1.5 transition-colors focus-within:border-signal-500 dark:border-white/[0.07] ${ariaInvalid === 'true' || ariaInvalid === true ? 'border-status-red' : ''}`}
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
              className="flex items-center gap-1 rounded-full bg-slate-900/[0.06] px-2 py-0.5 text-[11px] font-semibold text-slate-700 dark:bg-white/[0.08] dark:text-slate-300"
            >
              {label}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  removeTag(tag);
                }}
                className="hover:text-status-red focus:outline-none"
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
          className="min-w-[60px] flex-1 bg-transparent text-xs text-slate-700 outline-none placeholder:text-slate-400 dark:text-slate-200"
        />
      </div>

      {isOpen && filteredOptions.length > 0 && (
        <div
          id={listboxId}
          role="listbox"
          ref={listboxRef}
          onKeyDown={handleListboxKeyDown}
          className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-black/[0.08] bg-white py-1 shadow-lg dark:border-white/[0.08] dark:bg-void-800"
        >
          {filteredOptions.map((option) => {
            const isSelected = value.includes(option.value);
            return (
              <div
                key={option.value}
                role="option"
                aria-selected={isSelected}
                tabIndex={-1}
                className={`flex cursor-pointer items-center px-3 py-2 text-xs hover:bg-black/[0.04] dark:hover:bg-white/[0.05] focus:bg-black/[0.04] dark:focus:bg-white/[0.05] focus:ring-1 focus:ring-inset focus:ring-signal-500/50 outline-none ${
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
                  className="mr-2 h-3 w-3 rounded border-slate-300 text-signal-500 focus:ring-signal-500 dark:border-white/[0.18] dark:bg-transparent pointer-events-none"
                />
                {option.label}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
