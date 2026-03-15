import type { FunctionComponent } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import {
  ClipboardList,
  Loader2,
  Rocket,
  Save,
  Sparkles,
  Target,
  X,
} from "lucide-preact";
import type { Sprint } from "../../types.js";

export type SprintSubmitMode = "plan_and_start" | "plan_only" | "draft";

interface SprintDraftInput {
  name: string;
  goal: string;
}

interface SprintComposerProps {
  nextId: string;
  initialSprint?: Sprint | null;
  planningRouteLabel?: string | null;
  onClose: () => void;
  onImprovePrompt?: (draft: SprintDraftInput) => Promise<string>;
  onSubmit: (payload: SprintDraftInput & { submitMode: SprintSubmitMode }) => Promise<void> | void;
}

const CREATE_MODES: Array<{
  id: SprintSubmitMode;
  label: string;
  description: string;
  icon: typeof Rocket;
}> = [
  {
    id: "plan_and_start",
    label: "Plan & Start",
    description: "Create the sprint, let the Planning agent build subtasks, then launch immediately.",
    icon: Rocket,
  },
  {
    id: "plan_only",
    label: "Plan Only",
    description: "Create the sprint and have the Planning agent generate subtasks without starting execution.",
    icon: ClipboardList,
  },
  {
    id: "draft",
    label: "Save Draft",
    description: "Store the sprint only and keep planning for later.",
    icon: Save,
  },
];

export const SprintComposer: FunctionComponent<SprintComposerProps> = ({
  nextId,
  initialSprint = null,
  planningRouteLabel = null,
  onClose,
  onImprovePrompt,
  onSubmit,
}) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const fieldsRef = useRef<HTMLFormElement>(null);
  const [name, setName] = useState(initialSprint?.name || "");
  const [goal, setGoal] = useState(initialSprint?.goal || "");
  const [isImproving, setIsImproving] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitMode, setSubmitMode] = useState<SprintSubmitMode>("plan_and_start");
  const isEditing = Boolean(initialSprint);
  const activeMode = CREATE_MODES.find((mode) => mode.id === submitMode) || CREATE_MODES[0]!;
  const SubmitIcon = isEditing ? Save : activeMode.icon;

  useEffect(() => {
    setName(initialSprint?.name || "");
    setGoal(initialSprint?.goal || "");
    setSubmitMode("plan_and_start");
    setIsImproving(false);
    setIsSubmitting(false);
  }, [initialSprint?.id]);

  useLayoutEffect(() => {
    const timeline = gsap.timeline();

    if (cardRef.current) {
      timeline.fromTo(
        cardRef.current,
        { y: 28, opacity: 0, scale: 0.985, filter: "blur(14px)" },
        { y: 0, opacity: 1, scale: 1, filter: "blur(0px)", duration: 0.72, ease: "power4.out" },
      );
    }

    if (fieldsRef.current) {
      timeline.fromTo(
        Array.from(fieldsRef.current.querySelectorAll("[data-composer-stagger]")),
        { y: 18, opacity: 0 },
        { y: 0, opacity: 1, stagger: 0.055, duration: 0.5, ease: "power3.out" },
        "-=0.45",
      );
    }
  }, [initialSprint?.id]);

  const handleImprovePrompt = async (): Promise<void> => {
    if (!onImprovePrompt || !name.trim() || !goal.trim()) {
      return;
    }
    setIsImproving(true);
    try {
      const improvedGoal = await onImprovePrompt({
        name: name.trim(),
        goal: goal.trim(),
      });
      setGoal(improvedGoal);
    } finally {
      setIsImproving(false);
    }
  };

  const handleSubmit = async (event: Event) => {
    event.preventDefault();
    if (!name.trim()) {
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        goal: goal.trim(),
        submitMode: isEditing ? "draft" : submitMode,
      });
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section
      ref={cardRef}
      className="relative w-full overflow-hidden rounded-[2rem] border border-black/[0.06] bg-white/78 shadow-[0_20px_50px_rgba(15,23,42,0.08)] backdrop-blur-2xl dark:border-white/[0.06] dark:bg-void-800/72 dark:shadow-[0_24px_56px_rgba(0,0,0,0.28)]"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(0,224,160,0.08),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(255,184,0,0.08),transparent_34%)] dark:bg-[radial-gradient(circle_at_top_left,rgba(0,224,160,0.1),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(255,184,0,0.09),transparent_34%)]" />

      <form
        ref={fieldsRef}
        onSubmit={handleSubmit}
        className="relative z-10 grid gap-0 xl:grid-cols-[minmax(0,1fr)_21rem]"
      >
        <div className="border-b border-black/[0.06] p-6 dark:border-white/[0.06] sm:p-8 lg:p-10 xl:border-b-0 xl:border-r">
          <div data-composer-stagger className="flex items-start justify-between gap-4">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-signal-500/15 bg-signal-500/[0.07] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-signal-600 dark:text-signal-300">
                <Target className="h-3.5 w-3.5" strokeWidth={2.3} />
                {isEditing ? "Edit Sprint" : "Sprint Composer"}
              </div>
              <div className="space-y-3">
                <h2 className="font-display text-[2rem] font-black leading-none tracking-tight text-slate-900 dark:text-white sm:text-[2.35rem]">
                  {isEditing ? "Refine The Sprint." : "Compose The Next Sprint."}
                </h2>
                <p className="max-w-2xl text-sm leading-relaxed text-slate-500 dark:text-slate-400 sm:text-[15px]">
                  {isEditing
                    ? "Adjust the sprint definition without changing its execution history."
                    : "The showcase folds away while you write. Define the sprint once, improve the prompt if needed, and let the Planning agent take the first pass at subtasks."}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-black/[0.06] bg-white/78 text-slate-400 transition-colors hover:text-slate-900 dark:border-white/[0.06] dark:bg-white/[0.03] dark:hover:text-white"
              aria-label="Close sprint composer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div data-composer-stagger className="mt-8 grid gap-3 sm:grid-cols-2">
            <div className="rounded-[1.4rem] border border-black/[0.06] bg-black/[0.025] p-4 dark:border-white/[0.06] dark:bg-white/[0.03]">
              <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400">Sprint Key</div>
              <div className="mt-2 font-mono text-3xl font-black tracking-tight text-slate-900 dark:text-white">
                {(initialSprint?.number ? `SPR-${initialSprint.number}` : nextId).toUpperCase()}
              </div>
            </div>
            <div className="rounded-[1.4rem] border border-black/[0.06] bg-black/[0.025] p-4 dark:border-white/[0.06] dark:bg-white/[0.03]">
              <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400">Planning Route</div>
              <div className={`mt-2 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] ${
                planningRouteLabel
                  ? "border-signal-500/20 bg-signal-500/[0.08] text-signal-600 dark:text-signal-300"
                  : "border-status-red/20 bg-status-red/10 text-status-red"
              }`}>
                <Sparkles className="h-3.5 w-3.5" strokeWidth={2.2} />
                {planningRouteLabel ? planningRouteLabel : "Unavailable"}
              </div>
            </div>
          </div>

          <label data-composer-stagger className="mt-8 block space-y-2">
            <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400">Sprint Name</span>
            <input
              type="text"
              value={name}
              onInput={(event) => setName((event.target as HTMLInputElement).value)}
              placeholder="Runtime hardening"
              className="w-full border-0 border-b-2 border-black/[0.08] bg-transparent pb-3 font-display text-[1.65rem] font-black leading-none tracking-tight text-slate-900 outline-none transition-colors placeholder:text-slate-200 focus:border-signal-500 dark:border-white/[0.08] dark:text-white dark:placeholder:text-slate-700 sm:text-[1.9rem]"
              required
              autoFocus
            />
          </label>

          <div data-composer-stagger className="mt-8 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400">Sprint Prompt</label>
              {!isEditing && (
                <button
                  type="button"
                  onClick={() => { void handleImprovePrompt(); }}
                  disabled={isImproving || !name.trim() || !goal.trim()}
                  className="inline-flex items-center gap-2 rounded-full border border-signal-500/20 bg-signal-500/[0.08] px-3.5 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-signal-600 transition-colors hover:bg-signal-500/[0.14] disabled:cursor-not-allowed disabled:opacity-50 dark:text-signal-300"
                >
                  {isImproving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" strokeWidth={2.2} />}
                  {isImproving ? "Improving" : "Improve with AI"}
                </button>
              )}
            </div>

            <div className={`rounded-[1.7rem] border bg-black/[0.025] transition-all dark:bg-white/[0.03] ${
              isImproving
                ? "border-signal-500/35 shadow-[0_0_0_1px_rgba(0,224,160,0.16),0_0_30px_rgba(0,224,160,0.1)]"
                : "border-black/[0.07] dark:border-white/[0.08]"
            }`}>
              <textarea
                value={goal}
                onInput={(event) => setGoal((event.target as HTMLTextAreaElement).value)}
                placeholder="Describe the outcome, affected systems, and what done looks like when this sprint lands."
                className="min-h-[220px] w-full resize-none rounded-[1.7rem] bg-transparent px-4 py-4 text-sm leading-relaxed text-slate-700 outline-none placeholder:text-slate-300 dark:text-slate-300 dark:placeholder:text-slate-600 sm:min-h-[260px] sm:px-5"
              />
            </div>
          </div>
        </div>

        <aside className="flex flex-col gap-4 p-6 sm:p-8">
          {!isEditing && (
            <div data-composer-stagger>
              <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400">Creation Route</div>
              <div className="mt-3 grid gap-3">
                {CREATE_MODES.map((mode) => {
                  const ModeIcon = mode.icon;
                  const isActive = submitMode === mode.id;
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => setSubmitMode(mode.id)}
                      className={`rounded-[1.35rem] border p-4 text-left transition-all ${
                        isActive
                          ? "border-signal-500/30 bg-signal-500/[0.08] shadow-[0_12px_24px_rgba(0,224,160,0.08)]"
                          : "border-black/[0.06] bg-white/66 hover:border-black/[0.1] hover:bg-white dark:border-white/[0.06] dark:bg-white/[0.02] dark:hover:border-white/[0.1]"
                      }`}
                    >
                      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-700 dark:text-white">
                        <ModeIcon className={`h-3.5 w-3.5 ${isActive ? "text-signal-500" : "text-slate-400"}`} strokeWidth={2.1} />
                        {mode.label}
                      </div>
                      <div className="mt-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                        {mode.description}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div data-composer-stagger className="mt-auto flex flex-col gap-3 pt-2">
            <button
              type="submit"
              disabled={isSubmitting || !name.trim()}
              className="inline-flex items-center justify-center gap-2.5 rounded-[1.2rem] bg-slate-900 px-5 py-3 text-sm font-bold text-white shadow-[0_12px_28px_rgba(15,23,42,0.16)] transition-all hover:-translate-y-px hover:opacity-92 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-void-900"
            >
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <SubmitIcon className="h-4 w-4" strokeWidth={2.3} />}
              {isEditing ? "Save Changes" : activeMode.label}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-[1.2rem] border border-black/[0.06] bg-white/66 px-5 py-3 text-sm font-semibold text-slate-500 transition-colors hover:text-slate-900 dark:border-white/[0.06] dark:bg-white/[0.02] dark:text-slate-300 dark:hover:text-white"
            >
              Cancel
            </button>
          </div>
        </aside>
      </form>
    </section>
  );
};
