import type { FunctionComponent } from "preact";
import {
  getPromptSuggestionIcon,
  resolvePromptSuggestionIconName,
  type PromptSuggestionViewModel,
} from "../../lib/chat-suggestion-view-models.js";

export interface PromptSuggestionTagsProps {
  suggestions: PromptSuggestionViewModel[];
  onSelect?: (suggestion: PromptSuggestionViewModel) => void;
  className?: string;
}

const tagClasses = "inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full border border-slate-900/10 bg-white/75 px-2.5 py-1.5 text-left text-xs font-semibold leading-snug text-slate-700 shadow-[0_1px_6px_rgba(15,23,42,0.04)] backdrop-blur transition-colors hover:border-signal-500/30 hover:bg-signal-500/[0.08] hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-200 dark:hover:border-signal-400/40 dark:hover:bg-signal-400/[0.12] dark:hover:text-white dark:focus-visible:ring-signal-400/70 dark:focus-visible:ring-offset-void-900";
const readOnlyTagClasses = "inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full border border-slate-900/10 bg-white/60 px-2.5 py-1.5 text-xs font-semibold leading-snug text-slate-600 shadow-[0_1px_6px_rgba(15,23,42,0.03)] backdrop-blur dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-300";

const PromptSuggestionIcon: FunctionComponent<{ icon: PromptSuggestionViewModel["icon"] }> = ({ icon }) => {
  const iconName = resolvePromptSuggestionIconName(icon);
  const Icon = getPromptSuggestionIcon(iconName);

  return (
    <span
      aria-hidden="true"
      className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center"
      data-prompt-suggestion-icon={iconName}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden="true" focusable="false" />
    </span>
  );
};

export const PromptSuggestionTags: FunctionComponent<PromptSuggestionTagsProps> = ({
  suggestions,
  onSelect,
  className = "",
}) => {
  if (suggestions.length === 0) {
    return null;
  }

  return (
    <div className={`flex max-w-full min-w-0 flex-wrap items-center gap-2 ${className}`.trim()}>
      {suggestions.map((suggestion) => {
        const label = (
          <>
            <PromptSuggestionIcon icon={suggestion.icon} />
            <span className="min-w-0 max-w-full overflow-hidden text-ellipsis whitespace-nowrap break-words">
              {suggestion.label}
            </span>
          </>
        );

        if (onSelect) {
          return (
            <button
              key={suggestion.key}
              type="button"
              className={tagClasses}
              aria-label={`Use suggestion: ${suggestion.label}`}
              title={suggestion.label}
              onClick={() => onSelect(suggestion)}
            >
              {label}
            </button>
          );
        }

        return (
          <span key={suggestion.key} className={readOnlyTagClasses} title={suggestion.label}>
            {label}
          </span>
        );
      })}
    </div>
  );
};
