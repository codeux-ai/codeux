import { type FunctionComponent } from "preact";
import { useLayoutEffect, useId, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import { Brain, ChevronRight } from "lucide-preact";
import { useReducedMotion } from "../../../hooks/use-reduced-motion.js";
import { INTERACTION_TOKENS } from "../../../lib/motion/tokens.js";
import { formatTokenCount, type ParsedTurnTokens } from "../../../lib/chat-widget-view-models.js";

export interface ReasoningWidgetProps {
  text: string;
  providerLabel?: string | null;
  modelLabel?: string | null;
  tokens?: ParsedTurnTokens | null;
  createdAtLabel?: string | null;
  ariaLabel?: string;
}

const PREVIEW_CHARS = 220;

const getTokenCount = (tokens?: ParsedTurnTokens | null): number | null => {
  if (!tokens) {
    return null;
  }

  if (typeof tokens.reasoning === "number") {
    return tokens.reasoning;
  }

  if (typeof tokens.total === "number") {
    return tokens.total;
  }

  const total = (tokens.input ?? 0) + (tokens.cached ?? 0) + (tokens.output ?? 0);
  return total > 0 ? total : null;
};

const chipClassName = "inline-flex max-w-[150px] items-center gap-1 truncate rounded-full bg-black/[0.04] px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-white/[0.05] dark:text-slate-400";

export const ReasoningWidget: FunctionComponent<ReasoningWidgetProps> = ({
  text,
  providerLabel,
  modelLabel,
  tokens,
  createdAtLabel,
  ariaLabel = "Reasoning turn",
}) => {
  const [expanded, setExpanded] = useState(false);
  const [hasAnimatedOnce, setHasAnimatedOnce] = useState(false);
  const contentRef = useRef<HTMLParagraphElement>(null);
  const contentId = useId();
  const prefersReducedMotion = useReducedMotion();
  const trimmed = (text || "").trim();
  const isLong = trimmed.length > PREVIEW_CHARS;
  const preview = isLong ? `${trimmed.slice(0, PREVIEW_CHARS).trimEnd()}…` : trimmed;
  const tokenCount = getTokenCount(tokens);

  useLayoutEffect(() => {
    if (!contentRef.current) {
      return;
    }

    const el = contentRef.current;
    if (prefersReducedMotion) {
      gsap.set(el, { opacity: 1 });
      return;
    }

    gsap.fromTo(
      el,
      { opacity: hasAnimatedOnce ? 1 : 0.65 },
      {
        opacity: 1,
        duration: parseFloat(INTERACTION_TOKENS.expansionCollapse.duration) / 1000,
        ease: INTERACTION_TOKENS.expansionCollapse.ease,
      }
    );
    setHasAnimatedOnce(true);
  }, [expanded, hasAnimatedOnce, prefersReducedMotion]);

  const headerTokens = [
    providerLabel,
    modelLabel,
    tokenCount !== null ? `${formatTokenCount(tokenCount)} tok` : null,
    createdAtLabel,
  ].filter((value): value is string => Boolean(value));

  return (
    <div
      role="region"
      aria-label={ariaLabel}
      class="overflow-hidden rounded-xl border border-black/[0.04] bg-slate-50/60 dark:border-white/[0.04] dark:bg-white/[0.02]"
    >
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={contentId}
        disabled={!isLong}
        onClick={() => setExpanded((value) => !value)}
        class={`flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors ${
          isLong ? "hover:bg-black/[0.03] dark:hover:bg-white/[0.03]" : "cursor-default"
        }`}
      >
        <span class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-violet-500/[0.1]">
          <Brain size={13} class="text-violet-500 dark:text-violet-400" />
        </span>

        <span class="min-w-0 flex-1">
          <span class="flex flex-wrap items-center gap-1.5">
            <span class="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Reasoning</span>
            {headerTokens.map((token) => (
              <span key={token} class={chipClassName}>{token}</span>
            ))}
          </span>
          <span class="mt-1 block text-[12.5px] leading-6 text-slate-600 dark:text-slate-300">
            {isLong ? (expanded ? "Hide reasoning" : "Show reasoning") : "Reasoning"}
          </span>
        </span>

        {isLong && (
          <ChevronRight
            size={14}
            class={`mt-1 shrink-0 text-slate-400 transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
          />
        )}
      </button>

      <div
        id={contentId}
        aria-hidden={isLong ? !expanded : false}
        class={`border-t border-black/[0.04] px-3 py-3 dark:border-white/[0.04] ${isLong ? "overflow-hidden" : ""}`}
      >
        <p
          ref={contentRef}
          class={`whitespace-pre-wrap break-words text-[12.5px] leading-6 text-slate-500 dark:text-slate-400 ${
            isLong && !expanded ? "max-h-[5.25rem] overflow-hidden" : ""
          }`}
        >
          {isLong && !expanded ? preview : trimmed || "No reasoning text"}
        </p>
      </div>
    </div>
  );
};
