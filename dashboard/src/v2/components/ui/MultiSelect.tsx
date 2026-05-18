import type { FunctionComponent } from "preact";
import { useState, useRef } from "preact/hooks";
import { X } from "lucide-preact";

interface MultiSelectProps {
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  className?: string;
}

export const MultiSelect: FunctionComponent<MultiSelectProps> = ({
  value,
  onChange,
  placeholder = "Add label...",
  className = "",
}) => {
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

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

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(inputValue);
    } else if (e.key === "Backspace" && inputValue === "" && value.length > 0) {
      // Remove last tag if input is empty
      removeTag(value[value.length - 1]);
    }
  };

  const handleBlur = () => {
    addTag(inputValue);
  };

  return (
    <div
      className={`flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-[0.95rem] border border-black/[0.06] bg-transparent px-3 py-1.5 transition-colors focus-within:border-signal-500 dark:border-white/[0.07] ${className}`}
      onClick={() => inputRef.current?.focus()}
    >
      {value.map((tag) => (
        <span
          key={tag}
          className="flex items-center gap-1 rounded-full bg-slate-900/[0.06] px-2 py-0.5 text-[11px] font-semibold text-slate-700 dark:bg-white/[0.08] dark:text-slate-300"
        >
          {tag}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              removeTag(tag);
            }}
            className="hover:text-status-red focus:outline-none"
            aria-label={`Remove ${tag}`}
          >
            <X className="h-3 w-3" strokeWidth={2.5} />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        type="text"
        value={inputValue}
        onInput={(e) => setInputValue((e.target as HTMLInputElement).value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        placeholder={value.length === 0 ? placeholder : ""}
        className="min-w-[60px] flex-1 bg-transparent text-xs text-slate-700 outline-none placeholder:text-slate-400 dark:text-slate-200"
      />
    </div>
  );
};
