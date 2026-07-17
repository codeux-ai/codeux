import type { FunctionComponent } from "preact";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import { ArrowLeft, ArrowRight, BookOpen, Box, CalendarDays, Check, Compass, EyeOff, FolderOpen, FolderTree, LayoutDashboard, Library, MessageCircle, Sparkles } from "lucide-preact";
import { DASHBOARD_TOUR_START_EVENT, DASHBOARD_TOUR_STORAGE_KEY } from "../../lib/onboarding-control.js";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { useInteractionTokens } from "../../lib/motion/tokens.js";
import { GSAP_INTERACTION_TOKENS, useGsapInteractionTokens } from "../../lib/motion/constants.js";
import { useFocusTrap } from "../../hooks/use-focus-trap.js";
import type { DashboardFeatureId } from "../../lib/dashboard-feature-flags.js";
import { isDashboardFeatureEnabled } from "../../lib/dashboard-feature-flags.js";
import { useOnboardingMessages, type OnboardingMessageKey } from "../../i18n/messages/onboarding.js";

type TourStep = {
  id: string;
  targetId: string;
  eyebrow: string;
  title: string;
  body: string;
  accent: "signal" | "ember" | "sky";
  feature?: DashboardFeatureId;
};

type RectState = {
  top: number;
  left: number;
  width: number;
  height: number;
};

type TourTranslate = (key: OnboardingMessageKey, variables?: Readonly<Record<string, string | number | bigint | boolean | undefined>>) => string;

const getTourSteps = (t: TourTranslate): TourStep[] => [
  {
    id: "projects",
    targetId: "project-selector",
    eyebrow: t("tourWorkspaceEyebrow"), title: t("tourProjectsTitle"), body: t("tourProjectsBody"),
    accent: "signal",
  },
  {
    id: "docker",
    targetId: "docker-containers",
    eyebrow: t("tourRuntimeEyebrow"), title: t("tourDockerTitle"), body: t("tourDockerBody"),
    accent: "ember",
  },
  {
    id: "sessions",
    targetId: "active-sessions",
    eyebrow: t("tourPreviewEyebrow"), title: t("tourSessionsTitle"), body: t("tourSessionsBody"),
    accent: "sky",
  },
  {
    id: "chat",
    targetId: "nav-chat",
    eyebrow: t("tourCommandEyebrow"), title: t("tourChatTitle"), body: t("tourChatBody"),
    accent: "signal",
  },
  {
    id: "overview",
    targetId: "nav-overview",
    eyebrow: t("tourOverviewEyebrow"), title: t("tourOverviewTitle"), body: t("tourOverviewBody"),
    accent: "signal",
  },
  {
    id: "sprints",
    targetId: "nav-sprints",
    eyebrow: t("tourPlanningEyebrow"), title: t("tourSprintsTitle"), body: t("tourSprintsBody"),
    accent: "ember",
  },
  {
    id: "tasks",
    targetId: "nav-tasks",
    eyebrow: t("tourExecutionEyebrow"), title: t("tourTasksTitle"), body: t("tourTasksBody"),
    accent: "signal",
  },
  {
    id: "agents",
    targetId: "nav-agents",
    eyebrow: t("tourWorkersEyebrow"), title: t("tourAgentsTitle"), body: t("tourAgentsBody"),
    accent: "signal",
  },
  {
    id: "nodes",
    targetId: "nav-nodes",
    eyebrow: t("tourWorkflowEyebrow"), title: t("tourNodesTitle"), body: t("tourNodesBody"),
    accent: "signal",
    feature: "nodes",
  },
  {
    id: "custom-dashboards",
    targetId: "nav-custom-dashboards",
    eyebrow: t("tourDashboardEyebrow"), title: t("tourDashboardsTitle"), body: t("tourDashboardsBody"),
    accent: "signal",
    feature: "custom-dashboards",
  },
  {
    id: "stats",
    targetId: "nav-stats",
    eyebrow: t("tourTelemetryEyebrow"), title: t("tourStatsTitle"), body: t("tourStatsBody"),
    accent: "ember",
  },
  {
    id: "schedule",
    targetId: "nav-schedule",
    eyebrow: t("tourOrchestrationEyebrow"), title: t("tourScheduleTitle"), body: t("tourScheduleBody"),
    accent: "signal",
  },
  {
    id: "memory",
    targetId: "nav-memory",
    eyebrow: t("tourContinuityEyebrow"), title: t("tourMemoryTitle"), body: t("tourMemoryBody"),
    accent: "ember",
  },
  {
    id: "knowledge",
    targetId: "nav-knowledge",
    eyebrow: t("tourReferenceEyebrow"), title: t("tourKnowledgeTitle"), body: t("tourKnowledgeBody"),
    accent: "signal",
  },
  {
    id: "browser",
    targetId: "nav-browser",
    eyebrow: t("tourPreviewLabEyebrow"), title: t("tourBrowserTitle"), body: t("tourBrowserBody"),
    accent: "sky",
  },
  {
    id: "files",
    targetId: "nav-files",
    eyebrow: t("tourSourceEyebrow"), title: t("tourFilesTitle"), body: t("tourFilesBody"),
    accent: "signal",
  },
  {
    id: "live",
    targetId: "nav-live",
    eyebrow: t("tourRealtimeEyebrow"), title: t("tourLiveTitle"), body: t("tourLiveBody"),
    accent: "ember",
  },
  {
    id: "docs",
    targetId: "nav-docs",
    eyebrow: t("tourGuideEyebrow"), title: t("tourDocsTitle"), body: t("tourDocsBody"),
    accent: "sky",
  },
  {
    id: "config",
    targetId: "nav-config",
    eyebrow: t("tourControlEyebrow"), title: t("tourSettingsTitle"), body: t("tourSettingsBody"),
    accent: "signal",
  },
];

const accentClasses: Record<TourStep["accent"], { text: string; bg: string; bgSoft: string; bgPanel: string; border: string; shadow: string; line: string }> = {
  signal: {
    text: "text-signal-300",
    bg: "bg-signal-500",
    bgSoft: "bg-signal-500/10",
    bgPanel: "bg-signal-500/15",
    border: "border-signal-400/35",
    shadow: "shadow-[0_0_42px_rgba(0,224,160,0.22)]",
    line: "#00E0A0",
  },
  ember: {
    text: "text-ember-300",
    bg: "bg-ember-500",
    bgSoft: "bg-ember-500/10",
    bgPanel: "bg-ember-500/15",
    border: "border-ember-400/35",
    shadow: "shadow-[0_0_42px_rgba(255,184,0,0.18)]",
    line: "#FFB800",
  },
  sky: {
    text: "text-sky-300",
    bg: "bg-sky-500",
    bgSoft: "bg-sky-500/10",
    bgPanel: "bg-sky-500/15",
    border: "border-sky-400/35",
    shadow: "shadow-[0_0_42px_rgba(14,165,233,0.2)]",
    line: "#38BDF8",
  },
};

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

const durationToMilliseconds = (duration: string): number => (
  duration.endsWith("ms") ? Number.parseFloat(duration) : Number.parseFloat(duration) * 1_000
);

const getTourElement = (targetId: string): HTMLElement | null => (
  document.querySelector(`[data-tour-id="${targetId}"]`) as HTMLElement | null
);

const isVisibleTarget = (element: HTMLElement): boolean => {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return rect.width > 0
    && rect.height > 0
    && style.display !== "none"
    && style.visibility !== "hidden"
    && rect.bottom > 0
    && rect.right > 0
    && rect.top < window.innerHeight
    && rect.left < window.innerWidth;
};

const readRect = (element: HTMLElement): RectState => {
  const rect = element.getBoundingClientRect();
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  };
};

export const GuidedDashboardTour: FunctionComponent = () => {
  const { t } = useOnboardingMessages();
  const tourSteps = useMemo(() => getTourSteps(t), [t]);
  const cardRef = useRef<HTMLDivElement>(null);
  const lineLayerRef = useRef<SVGSVGElement>(null);
  const linePathRef = useRef<SVGPathElement>(null);
  const targetRingRef = useRef<HTMLDivElement>(null);
  const primaryActionRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const delayedStartRef = useRef<number | null>(null);
  const suppressAutoAdvanceRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [availableSteps, setAvailableSteps] = useState<TourStep[]>([]);
  const [targetRect, setTargetRect] = useState<RectState | null>(null);
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const reducedMotion = useReducedMotion();
  const interactionTokens = useInteractionTokens();
  const gsapTokens = useGsapInteractionTokens();
  const hideTour = useCallback(() => {
    window.localStorage.setItem(DASHBOARD_TOUR_STORAGE_KEY, "true");
    if (delayedStartRef.current !== null) {
      window.clearTimeout(delayedStartRef.current);
      delayedStartRef.current = null;
    }
    setOpen(false);
  }, []);
  const trapRef = useFocusTrap(open, {
    onClose: hideTour,
    initialFocusRef: primaryActionRef,
    restoreFocusRef,
    restoreFocus: true,
  });

  const refreshSteps = useCallback(() => {
    const steps = tourSteps.filter((step) => {
      if (step.feature && !isDashboardFeatureEnabled(step.feature)) {
        return false;
      }
      const element = getTourElement(step.targetId);
      return element ? isVisibleTarget(element) : false;
    });
    setAvailableSteps(steps);
    setActiveIndex((current) => clamp(current, 0, Math.max(steps.length - 1, 0)));
    return steps;
  }, [tourSteps]);

  const activeStep = availableSteps[activeIndex] || null;
  const targetReady = Boolean(targetRect);

  useEffect(() => {
    if (open) {
      refreshSteps();
    }
  }, [open, refreshSteps]);

  const updateTargetRect = useCallback(() => {
    if (!activeStep) {
      setTargetRect(null);
      return;
    }
    const element = getTourElement(activeStep.targetId);
    if (!element || !isVisibleTarget(element)) {
      refreshSteps();
      return;
    }
    setTargetRect(readRect(element));
  }, [activeStep, refreshSteps]);

  useEffect(() => {
    const start = () => {
      if (delayedStartRef.current !== null) {
        window.clearTimeout(delayedStartRef.current);
      }
      delayedStartRef.current = window.setTimeout(() => {
        delayedStartRef.current = null;
        restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const steps = refreshSteps();
        if (steps.length === 0) {
          return;
        }
        setActiveIndex(0);
        setProgress(0);
        suppressAutoAdvanceRef.current = false;
        setOpen(true);
      }, durationToMilliseconds(interactionTokens.enterExit.duration));
    };
    window.addEventListener(DASHBOARD_TOUR_START_EVENT, start);
    return () => {
      window.removeEventListener(DASHBOARD_TOUR_START_EVENT, start);
      if (delayedStartRef.current !== null) {
        window.clearTimeout(delayedStartRef.current);
        delayedStartRef.current = null;
      }
    };
  }, [interactionTokens.enterExit.duration, refreshSteps]);

  useLayoutEffect(() => {
    if (!open || !targetReady) {
      return;
    }
    primaryActionRef.current?.focus({ preventScroll: true });
  }, [activeIndex, open, targetReady]);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    updateTargetRect();
    const update = () => updateTargetRect();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    const interval = window.setInterval(
      update,
      Math.max(gsapTokens.asyncFeedback.duration, GSAP_INTERACTION_TOKENS.asyncFeedback.duration) * 1_000,
    );
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      window.clearInterval(interval);
    };
  }, [gsapTokens.asyncFeedback.duration, open, updateTargetRect]);

  useLayoutEffect(() => {
    if (!open || !targetReady || !cardRef.current) {
      return;
    }
    const animatedElements = [cardRef.current, lineLayerRef.current, targetRingRef.current].filter(Boolean);
    gsap.fromTo(
      animatedElements,
      { opacity: 0, y: reducedMotion ? 0 : 18, scale: reducedMotion ? 1 : 0.97, filter: reducedMotion ? "blur(0px)" : "blur(10px)" },
      { opacity: 1, y: 0, scale: 1, filter: "blur(0px)", duration: gsapTokens.enterExit.duration, ease: gsapTokens.enterExit.ease, clearProps: "filter" },
    );
    return () => {
      if (linePathRef.current) {
        gsap.killTweensOf(linePathRef.current);
      }
      animatedElements.forEach((el) => {
        if (el) gsap.killTweensOf(el);
      });
    };
  }, [activeIndex, gsapTokens.enterExit.duration, gsapTokens.enterExit.ease, open, reducedMotion, targetReady]);

  useEffect(() => {
    setProgress(0);
  }, [activeIndex]);

  useEffect(() => {
    if (!open || paused || reducedMotion || availableSteps.length <= 1) {
      return;
    }
    const interval = window.setInterval(() => {
      setProgress((current) => Math.min(100, current + 4));
    }, gsapTokens.asyncFeedback.duration * 1_000);
    return () => window.clearInterval(interval);
  }, [availableSteps.length, gsapTokens.asyncFeedback.duration, open, paused, reducedMotion]);

  useEffect(() => {
    if (progress < 100 || availableSteps.length === 0) {
      if (progress < 100) {
        suppressAutoAdvanceRef.current = false;
      }
      return;
    }
    if (suppressAutoAdvanceRef.current) {
      return;
    }
    if (activeIndex < availableSteps.length - 1) {
      suppressAutoAdvanceRef.current = true;
      setProgress(0);
      setActiveIndex((current) => current + 1);
      return;
    }
    setProgress(100);
  }, [activeIndex, availableSteps.length, progress]);

  const goPrevious = useCallback(() => {
    suppressAutoAdvanceRef.current = true;
    setProgress(0);
    setActiveIndex((current) => Math.max(0, current - 1));
  }, []);

  const goNext = useCallback(() => {
    suppressAutoAdvanceRef.current = true;
    setProgress(0);
    setActiveIndex((current) => Math.min(availableSteps.length - 1, current + 1));
  }, [availableSteps.length]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        if (activeIndex > 0) goPrevious();
      } else if (e.key === "ArrowRight") {
        if (activeIndex === availableSteps.length - 1) hideTour();
        else goNext();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, activeIndex, availableSteps.length, hideTour, goPrevious, goNext]);

  const geometry = useMemo(() => {
    if (!targetRect) {
      return null;
    }
    const width = Math.min(380, window.innerWidth - 32);
    const estimatedHeight = 270;
    const bottomAnchored = targetRect.top > window.innerHeight * 0.55;
    const gap = bottomAnchored ? 82 : 22;
    const targetCenterX = targetRect.left + targetRect.width / 2;
    const targetCenterY = targetRect.top + targetRect.height / 2;
    const belowTop = targetRect.top + targetRect.height + gap;
    const aboveTop = targetRect.top - estimatedHeight - gap;
    const top = belowTop + estimatedHeight < window.innerHeight - 16
      ? belowTop
      : Math.max(16, aboveTop);
    const left = clamp(targetCenterX - width / 2, 16, window.innerWidth - width - 16);
    const cardCenterX = left + width / 2;
    const cardCenterY = top + estimatedHeight / 2;
    return {
      width,
      card: { left, top },
      targetCenterX,
      targetCenterY,
      cardCenterX,
      cardCenterY,
    };
  }, [targetRect]);

  if (!open || !activeStep || !targetRect || !geometry) {
    return null;
  }

  const accent = accentClasses[activeStep.accent];
  const isLast = activeIndex === availableSteps.length - 1;
  const previousStep = availableSteps[Math.max(0, activeIndex - 1)] || null;
  const nextStep = availableSteps[Math.min(availableSteps.length - 1, activeIndex + 1)] || null;
  const tourProgressValue = reducedMotion
    ? Math.round(((activeIndex + 1) / availableSteps.length) * 100)
    : Math.round(progress);
  const tourStatusText = reducedMotion
    ? t("manualTourStatus", { current: activeIndex + 1, total: availableSteps.length, title: activeStep.title })
    : paused
      ? t("pausedTourStatus", { current: activeIndex + 1, total: availableSteps.length, title: activeStep.title })
      : t("tourStatus", { current: activeIndex + 1, total: availableSteps.length, title: activeStep.title });
  const path = `M ${geometry.targetCenterX} ${geometry.targetCenterY} C ${geometry.targetCenterX} ${geometry.cardCenterY}, ${geometry.cardCenterX} ${geometry.targetCenterY}, ${geometry.cardCenterX} ${geometry.cardCenterY}`;

  return (
    <div className="fixed inset-0 z-[180] pointer-events-none">
      <svg ref={lineLayerRef} className={`absolute inset-0 h-full w-full ${reducedMotion ? "opacity-100" : "opacity-0"}`} aria-hidden="true">
        <path
          ref={linePathRef}
          d={path}
          fill="none"
          stroke={accent.line}
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray="6 10"
          opacity="0.58"
        />
      </svg>

      <div
        ref={targetRingRef}
        aria-hidden="true"
        className={`absolute rounded-[1.35rem] border ${reducedMotion ? "opacity-100" : "opacity-0"} ${accent.border} ${accent.shadow}`}
        data-reduced-motion={reducedMotion ? "true" : undefined}
        style={{
          left: `${targetRect.left - 8}px`,
          top: `${targetRect.top - 8}px`,
          width: `${targetRect.width + 16}px`,
          height: `${targetRect.height + 16}px`,
        }}
      >
        <div className={`absolute inset-0 rounded-[1.35rem] ${accent.bgSoft}`} />
        <div className={`absolute inset-[-8px] rounded-[1.65rem] border ${accent.border} opacity-70 motion-safe:animate-ping motion-reduce:animate-none`} />
      </div>

      <div
        ref={(element) => {
          cardRef.current = element;
          trapRef.current = element;
        }}
        role="dialog"
        aria-modal="true"
        aria-live="polite"
        aria-labelledby="dashboard-tour-title"
        aria-describedby="dashboard-tour-description dashboard-tour-count"
        tabIndex={-1}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocusIn={() => setPaused(true)}
        onFocusOut={() => setPaused(false)}
        className="pointer-events-auto absolute overflow-hidden rounded-[1.75rem] border border-white/12 bg-void-950/88 p-5 text-white shadow-[0_34px_90px_rgba(0,0,0,0.46)] backdrop-blur-2xl"
        style={{
          left: `${geometry.card.left}px`,
          top: `${geometry.card.top}px`,
          width: `${geometry.width}px`,
          transitionDuration: interactionTokens.enterExit.duration,
          transitionTimingFunction: interactionTokens.enterExit.ease,
        }}
      >
        <div aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(0,224,160,0.14),transparent_34%),linear-gradient(135deg,rgba(255,255,255,0.09),transparent_42%)]" />
        <div aria-hidden="true" className="absolute -right-10 -top-10 h-32 w-32 rounded-full border border-white/10 bg-white/[0.035]" />
        <div className="relative z-10">
          <div className="flex items-center justify-between gap-3">
            <div className={`inline-flex items-center gap-2 rounded-full border ${accent.border} bg-white/[0.06] px-3 py-1.5`}>
              <Sparkles className={`h-3.5 w-3.5 ${accent.text}`} strokeWidth={2.4} />
              <span className={`text-[10px] font-black uppercase tracking-[0.18em] ${accent.text}`}>{activeStep.eyebrow}</span>
            </div>
            <div id="dashboard-tour-count" role="status" aria-live="polite" className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-white/45">
              {t("stepCount", { current: activeIndex + 1, total: availableSteps.length })}
            </div>
          </div>

          <div className="mt-5 flex items-start gap-4">
            <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${accent.bgPanel} ${accent.text} ring-1 ring-white/10`}>
              {activeStep.id === "projects" ? <FolderOpen className="h-5 w-5" /> : activeStep.id === "docker" ? <Box className="h-5 w-5" /> : activeStep.id === "chat" ? <MessageCircle className="h-5 w-5" /> : activeStep.id === "schedule" ? <CalendarDays className="h-5 w-5" /> : activeStep.id === "custom-dashboards" ? <LayoutDashboard className="h-5 w-5" /> : activeStep.id === "knowledge" ? <Library className="h-5 w-5" /> : activeStep.id === "files" ? <FolderTree className="h-5 w-5" /> : activeStep.id === "docs" ? <BookOpen className="h-5 w-5" /> : <Compass className="h-5 w-5" />}
            </div>
            <div>
              <h2 id="dashboard-tour-title" className="font-display text-xl font-semibold leading-none tracking-tight">{activeStep.title}</h2>
              <p id="dashboard-tour-description" className="mt-3 text-sm font-medium leading-relaxed text-slate-300">{activeStep.body}</p>
            </div>
          </div>

          <p className="mt-4 rounded-xl border border-white/10 bg-white/[0.055] px-3 py-2 text-xs font-semibold text-slate-300" role="status" aria-live="polite">
            {tourStatusText}
          </p>

          <div className="mt-4 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-label={reducedMotion ? t("tourStepProgress") : t("tourAutoProgress")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={tourProgressValue}>
            <div
              className={`h-1.5 rounded-full ${accent.bg} shadow-[0_0_18px_rgba(0,224,160,0.45)] transition-[width] motion-reduce:transition-none`}
              style={{ width: `${tourProgressValue}%`, transitionDuration: interactionTokens.selectionMovement.duration, transitionTimingFunction: interactionTokens.selectionMovement.ease }}
            />
          </div>

          <div className="mt-5 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={hideTour}
              aria-label={t("skipTourFrom", { title: activeStep.title })}
              className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold uppercase tracking-[0.12em] text-slate-400 transition-colors hover:bg-white/8 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50"
            >
              <EyeOff className="h-3.5 w-3.5" />
              {t("skip")}
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={activeIndex === 0}
                onClick={goPrevious}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.06] text-slate-300 transition-colors hover:bg-white/[0.1] hover:text-white disabled:cursor-not-allowed disabled:opacity-35 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 motion-reduce:transition-none"
                aria-label={previousStep && activeIndex > 0 ? t("previousTourStep", { title: previousStep.title }) : t("previousTourUnavailable")}
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                ref={primaryActionRef}
                onClick={isLast ? hideTour : goNext}
                aria-label={isLast ? t("finishTour") : nextStep ? t("nextTourStep", { title: nextStep.title }) : t("nextTour")}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-xs font-black uppercase tracking-[0.12em] text-void-950 transition-transform hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
                style={{ transitionDuration: interactionTokens.controlFeedback.duration, transitionTimingFunction: interactionTokens.controlFeedback.ease }}
              >
                {isLast ? (
                  <>
                    <Check className="h-4 w-4" />
                    {t("done")}
                  </>
                ) : (
                  <>
                    {t("next")}
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
