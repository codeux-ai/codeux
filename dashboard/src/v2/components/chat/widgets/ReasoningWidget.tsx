import { type FunctionComponent } from "preact";
import { useState, useRef, useLayoutEffect } from "preact/hooks";
import gsap from "gsap";
import { INTERACTION_TOKENS } from "../../../lib/motion/tokens.js";
import { useReducedMotion } from "../../../hooks/use-reduced-motion.js";
import { Brain, ChevronRight } from "lucide-preact";

export interface ReasoningWidgetProps {
  text: string;
}

const PREVIEW_CHARS = 180;

export const ReasoningWidget: FunctionComponent<ReasoningWidgetProps> = ({ text }) => {
  const [expanded, setExpanded] = useState(false);
  const contentRef = useRef<HTMLParagraphElement>(null);
  const prefersReducedMotion = useReducedMotion();

  useLayoutEffect(() => {
    if (!contentRef.current) return;
    const el = contentRef.current;
    if (prefersReducedMotion) return;

    // Animate opacity changes when text swaps, a simple and smooth transition
    gsap.fromTo(el, { opacity: 0.5 }, { opacity: 1, duration: parseFloat(INTERACTION_TOKENS.expansionCollapse.duration) / 1000, ease: INTERACTION_TOKENS.expansionCollapse.ease });
  }, [expanded, prefersReducedMotion]);
  const trimmed = (text || "").trim();
  const isLong = trimmed.length > PREVIEW_CHARS;
  const preview = isLong ? `${trimmed.slice(0, PREVIEW_CHARS).trimEnd()}…` : trimmed;

  return (
    <div class="overflow-hidden rounded-xl border border-dashed border-black/[0.04] dark:border-white/[0.04] bg-slate-50/50 dark:bg-white/[0.02]">
      <button
        type="button"
        disabled={!isLong}
        onClick={() => setExpanded((v) => !v)}
        class={`flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors ${isLong ? "hover:bg-black/[0.03] dark:hover:bg-white/[0.03]" : "cursor-default"}`}
      >
        <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-violet-500/[0.1]">
          <Brain size={13} class="text-violet-500 dark:text-violet-400" />
        </span>
        <span class="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Reasoning</span>
        {isLong && (
          <ChevronRight
            size={14}
            class={`ml-auto shrink-0 text-slate-400 transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
          />
        )}
      </button>
      <div class="px-3 pb-3 pt-0">
        <div aria-expanded={expanded}>
        <p ref={contentRef} class="whitespace-pre-wrap text-[12.5px] italic leading-relaxed text-slate-500 dark:text-slate-400">
          {expanded || !isLong ? trimmed : preview}
        </p>
      </div>
      </div>
    </div>
  );
};
