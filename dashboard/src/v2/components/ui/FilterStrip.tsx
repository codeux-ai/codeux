import { X } from "lucide-preact";
import { useId, useRef } from "preact/hooks";
import { MOTION_TOKENS } from "../../lib/motion/tokens.js";

type FilterOption<T extends string> = T | {
  value: T;
  label: string;
  disabled?: boolean;
};

/**
 * Generic tab filter strip. Pass a const array of option strings,
 * the active value, and an onChange handler.
 */
export function FilterStrip<T extends string>({
  options,
  active,
  onChange,
  showClear,
  onClear,
  label,
}: {
  options: readonly FilterOption<T>[];
  active: T;
  onChange: (value: T) => void;
  showClear?: boolean;
  onClear?: () => void;
  label?: string;
}) {
  const listId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const isActiveFiltered = active !== "all";

  const normalizedOptions = options.map((option) => {
    const isObj = typeof option === "object" && option !== null && "value" in option;
    if (isObj) {
        return {
            value: option.value,
            label: option.label,
            disabled: Boolean(option.disabled),
        };
    }
    return {
      value: option as T,
      label: option as string,
      disabled: false,
    };
  });

  const activeIndex = normalizedOptions.findIndex((option) => option.value === active);
  const fallbackEnabledIndex = normalizedOptions.findIndex((option) => !option.disabled);
  const focusIndex = activeIndex >= 0 ? activeIndex : fallbackEnabledIndex;

  const focusAndSelect = (index: number): void => {
    const option = normalizedOptions[index];
    if (!option || option.disabled) {
      return;
    }
    tabRefs.current[index]?.focus();
    onChange(option.value);
  };

  const getNextEnabledIndex = (startIndex: number, direction: 1 | -1): number => {
    if (!normalizedOptions.some((option) => !option.disabled)) {
      return -1;
    }

    let index = startIndex;
    for (let i = 0; i < normalizedOptions.length; i += 1) {
      index = (index + direction + normalizedOptions.length) % normalizedOptions.length;
      if (!normalizedOptions[index]?.disabled) {
        return index;
      }
    }

    return -1;
  };

  const getLastEnabledIndex = (): number => {
    for (let i = normalizedOptions.length - 1; i >= 0; i -= 1) {
      if (!normalizedOptions[i]?.disabled) {
        return i;
      }
    }
    return -1;
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {label && (
        <span className="mr-1 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500">
          {label}
        </span>
      )}
      <div 
        className="flex max-w-full gap-1 overflow-x-auto rounded-xl bg-black/[0.04] p-1 scrollbar-hide dark:bg-white/[0.04]" 
        role="tablist" 
        aria-orientation="horizontal"
      >
        {normalizedOptions.map((option, index) => {
          const isActive = active === option.value;

          return (
            <button
              key={option.value}
              ref={(el) => { tabRefs.current[index] = el; }}
              id={`${listId}-tab-${index}`}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-disabled={option.disabled || undefined}
              disabled={option.disabled}
              tabIndex={index === focusIndex ? 0 : -1}
              onClick={() => {
                if (!option.disabled) {
                  onChange(option.value);
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight") {
                  event.preventDefault();
                  const nextIndex = getNextEnabledIndex(index, 1);
                  if (nextIndex >= 0) {
                    focusAndSelect(nextIndex);
                  }
                  return;
                }

                if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  const nextIndex = getNextEnabledIndex(index, -1);
                  if (nextIndex >= 0) {
                    focusAndSelect(nextIndex);
                  }
                  return;
                }

                if (event.key === "Home") {
                  event.preventDefault();
                  const firstEnabledIndex = normalizedOptions.findIndex((item) => !item.disabled);
                  if (firstEnabledIndex >= 0) {
                    focusAndSelect(firstEnabledIndex);
                  }
                  return;
                }

                if (event.key === "End") {
                  event.preventDefault();
                  const lastEnabledIndex = getLastEnabledIndex();
                  if (lastEnabledIndex >= 0) {
                    focusAndSelect(lastEnabledIndex);
                  }
                }
              }}
              className={`relative flex-none touch-target rounded-lg px-3 py-1.5 text-xs font-semibold tracking-wide transition-[background-color,border-color,color,box-shadow,transform] focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-55 ${
                isActive
                  ? "bg-white text-slate-900 shadow-[0_1px_4px_rgba(0,0,0,0.08)] dark:bg-void-700 dark:text-white dark:shadow-[0_1px_4px_rgba(0,0,0,0.3)]"
                  : option.disabled
                    ? "text-slate-400 dark:text-slate-600"
                    : "text-slate-500 hover:bg-black/[0.03] hover:text-slate-700 dark:text-slate-500 dark:hover:bg-white/[0.03] dark:hover:text-slate-300"
              }`}
              style={{
                transitionDuration: MOTION_TOKENS.timing.fast,
                transitionTimingFunction: MOTION_TOKENS.easing.standard,
              }}
            >
              <span>{option.label}</span>
              <span
                aria-hidden="true"
                className={`pointer-events-none absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-signal-500 transition-opacity ${isActive ? "opacity-100" : "opacity-0"}`}
                style={{
                  transitionDuration: MOTION_TOKENS.timing.fast,
                  transitionTimingFunction: MOTION_TOKENS.easing.standard,
                }}
              />
            </button>
          );
        })}

        {(showClear || isActiveFiltered) && onClear && (
          <button
            type="button"
            onClick={onClear}
            className="ml-1 flex-none touch-target overflow-hidden rounded-lg border-l border-slate-300 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-ember-600 transition-[background-color,border-color,color,opacity,transform] focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 focus-visible:ring-offset-1 hover:bg-ember-500/[0.08] dark:border-slate-700 dark:text-ember-400"
            title="Clear filters"
            style={{
              transitionDuration: MOTION_TOKENS.timing.fast,
              transitionTimingFunction: MOTION_TOKENS.easing.standard,
            }}
          >
            <X className="mr-1 -mt-0.5 inline-block h-3 w-3" strokeWidth={3} />
            Reset
          </button>
        )}
      </div>
    </div>
  );
}
