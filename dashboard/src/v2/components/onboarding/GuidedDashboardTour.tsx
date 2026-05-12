import type { FunctionComponent } from "preact";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import { ArrowLeft, ArrowRight, Box, Check, Compass, EyeOff, FolderOpen, MessageCircle, Sparkles } from "lucide-preact";
import { DASHBOARD_TOUR_START_EVENT, DASHBOARD_TOUR_STORAGE_KEY } from "../../lib/onboarding-control.js";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";

type TourStep = {
  id: string;
  targetId: string;
  eyebrow: string;
  title: string;
  body: string;
  accent: "signal" | "ember" | "sky";
};

type RectState = {
  top: number;
  left: number;
  width: number;
  height: number;
};

const TOUR_STEPS: TourStep[] = [
  {
    id: "projects",
    targetId: "project-selector",
    eyebrow: "Workspace setup",
    title: "Projects",
    body: "Manage your Projects here. Add your first Project to start working.",
    accent: "signal",
  },
  {
    id: "docker",
    targetId: "docker-containers",
    eyebrow: "Runtime health",
    title: "Docker Containers",
    body: "This shows the container runtime Code UX depends on. Provider CLIs, task execution, and isolated workspaces run through Docker so every session stays reproducible.",
    accent: "ember",
  },
  {
    id: "sessions",
    targetId: "active-sessions",
    eyebrow: "Preview runtime",
    title: "Active Sessions",
    body: "Preview containers appear here while a sprint or browser session is running. Open them to inspect live app previews without leaving the dashboard.",
    accent: "sky",
  },
  {
    id: "chat",
    targetId: "nav-chat",
    eyebrow: "Command surface",
    title: "Chat",
    body: "Use Chat for focused collaboration with Code UX. Messages stay tied to the selected project and can route work toward connected MCP sessions.",
    accent: "signal",
  },
  {
    id: "overview",
    targetId: "nav-overview",
    eyebrow: "Mission control",
    title: "Overview",
    body: "Overview is the live dashboard for project health, runtime signals, active work, and the fastest path back to what needs attention.",
    accent: "signal",
  },
  {
    id: "sprints",
    targetId: "nav-sprints",
    eyebrow: "Planning flow",
    title: "Sprints",
    body: "Plan, import, inspect, and execute sprint work here. This is where larger initiatives become tracked, reviewable delivery streams.",
    accent: "ember",
  },
  {
    id: "tasks",
    targetId: "nav-tasks",
    eyebrow: "Execution queue",
    title: "Tasks",
    body: "Tasks break sprint intent into concrete work. Track dependencies, status, execution metadata, and what each agent should pick up next.",
    accent: "signal",
  },
  {
    id: "agents",
    targetId: "nav-agents",
    eyebrow: "Worker routing",
    title: "Agents",
    body: "Agents shows available workers, presets, live routing, and the provider options that power automated or assisted implementation.",
    accent: "signal",
  },
  {
    id: "stats",
    targetId: "nav-stats",
    eyebrow: "Telemetry",
    title: "Stats",
    body: "Stats turns execution history into signal: usage, throughput, code movement, and trends that help you understand delivery quality.",
    accent: "ember",
  },
  {
    id: "memory",
    targetId: "nav-memory",
    eyebrow: "Continuity",
    title: "Memory",
    body: "Memory keeps durable context from projects, agents, and sprints so future work can reuse decisions instead of rediscovering them.",
    accent: "ember",
  },
  {
    id: "browser",
    targetId: "nav-browser",
    eyebrow: "Preview lab",
    title: "Browser",
    body: "Browser is the in-app surface for preview containers. Use it to inspect running apps, navigate sessions, and validate work quickly.",
    accent: "sky",
  },
  {
    id: "live",
    targetId: "nav-live",
    eyebrow: "Realtime channel",
    title: "Live",
    body: "Live exposes active connections and runtime activity so you can see what is listening, connected, or waiting for work.",
    accent: "ember",
  },
  {
    id: "config",
    targetId: "nav-config",
    eyebrow: "Control room",
    title: "Settings",
    body: "Settings keeps every onboarding choice editable: providers, Docker behavior, AI behaviour, appearance, notifications, and defaults.",
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
  const cardRef = useRef<HTMLDivElement>(null);
  const lineLayerRef = useRef<SVGSVGElement>(null);
  const linePathRef = useRef<SVGPathElement>(null);
  const targetRingRef = useRef<HTMLDivElement>(null);
  const suppressAutoAdvanceRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [availableSteps, setAvailableSteps] = useState<TourStep[]>([]);
  const [targetRect, setTargetRect] = useState<RectState | null>(null);
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const reducedMotion = useReducedMotion();

  const refreshSteps = useCallback(() => {
    const steps = TOUR_STEPS.filter((step) => {
      const element = getTourElement(step.targetId);
      return element ? isVisibleTarget(element) : false;
    });
    setAvailableSteps(steps);
    setActiveIndex((current) => clamp(current, 0, Math.max(steps.length - 1, 0)));
    return steps;
  }, []);

  const activeStep = availableSteps[activeIndex] || null;
  const targetReady = Boolean(targetRect);

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
      window.setTimeout(() => {
        const steps = refreshSteps();
        if (steps.length === 0) {
          return;
        }
        setActiveIndex(0);
        setProgress(0);
        suppressAutoAdvanceRef.current = false;
        setOpen(true);
      }, 140);
    };
    window.addEventListener(DASHBOARD_TOUR_START_EVENT, start);
    return () => window.removeEventListener(DASHBOARD_TOUR_START_EVENT, start);
  }, [refreshSteps]);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    updateTargetRect();
    const update = () => updateTargetRect();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    const interval = window.setInterval(update, 450);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      window.clearInterval(interval);
    };
  }, [open, updateTargetRect]);

  useLayoutEffect(() => {
    if (!open || !targetReady || !cardRef.current) {
      return;
    }
    const animatedElements = [cardRef.current, lineLayerRef.current, targetRingRef.current].filter(Boolean);
    gsap.fromTo(
      animatedElements,
      { opacity: 0, y: reducedMotion ? 0 : 18, scale: reducedMotion ? 1 : 0.97, filter: reducedMotion ? "blur(0px)" : "blur(10px)" },
      { opacity: 1, y: 0, scale: 1, filter: "blur(0px)", duration: reducedMotion ? 0 : 0.42, ease: "power4.out", clearProps: "filter" },
    );
    if (!reducedMotion && linePathRef.current) {
      gsap.fromTo(
        linePathRef.current,
        { strokeDashoffset: 0 },
        { strokeDashoffset: -32, duration: 2.8, ease: "none", repeat: -1 },
      );
    }
    return () => {
      if (linePathRef.current) {
        gsap.killTweensOf(linePathRef.current);
      }
    };
  }, [activeIndex, open, reducedMotion, targetReady]);

  useEffect(() => {
    setProgress(0);
  }, [activeIndex]);

  useEffect(() => {
    if (!open || paused || reducedMotion || availableSteps.length <= 1) {
      return;
    }
    const interval = window.setInterval(() => {
      setProgress((current) => Math.min(100, current + 1.25));
    }, 100);
    return () => window.clearInterval(interval);
  }, [availableSteps.length, open, paused, reducedMotion]);

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

  const hideTour = () => {
    window.localStorage.setItem(DASHBOARD_TOUR_STORAGE_KEY, "true");
    setOpen(false);
  };

  const goPrevious = () => {
    suppressAutoAdvanceRef.current = true;
    setProgress(0);
    setActiveIndex((current) => Math.max(0, current - 1));
  };

  const goNext = () => {
    suppressAutoAdvanceRef.current = true;
    setProgress(0);
    setActiveIndex((current) => Math.min(availableSteps.length - 1, current + 1));
  };

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
  const path = `M ${geometry.targetCenterX} ${geometry.targetCenterY} C ${geometry.targetCenterX} ${geometry.cardCenterY}, ${geometry.cardCenterX} ${geometry.targetCenterY}, ${geometry.cardCenterX} ${geometry.cardCenterY}`;

  return (
    <div className="fixed inset-0 z-[180] pointer-events-none">
      <svg ref={lineLayerRef} className="absolute inset-0 h-full w-full opacity-0" aria-hidden="true">
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
        className={`absolute rounded-[1.35rem] border opacity-0 ${accent.border} ${accent.shadow}`}
        style={{
          left: `${targetRect.left - 8}px`,
          top: `${targetRect.top - 8}px`,
          width: `${targetRect.width + 16}px`,
          height: `${targetRect.height + 16}px`,
        }}
      >
        <div className={`absolute inset-0 rounded-[1.35rem] ${accent.bgSoft}`} />
        <div className={`absolute inset-[-8px] rounded-[1.65rem] border ${accent.border} opacity-70 animate-ping`} />
      </div>

      <div
        ref={cardRef}
        role="dialog"
        aria-live="polite"
        aria-label={`${activeStep.title} guided tour step`}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        className="pointer-events-auto absolute overflow-hidden rounded-[1.75rem] border border-white/12 bg-void-950/88 p-5 text-white shadow-[0_34px_90px_rgba(0,0,0,0.46)] backdrop-blur-2xl"
        style={{
          left: `${geometry.card.left}px`,
          top: `${geometry.card.top}px`,
          width: `${geometry.width}px`,
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
            <div className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-white/45">
              {activeIndex + 1}/{availableSteps.length}
            </div>
          </div>

          <div className="mt-5 flex items-start gap-4">
            <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${accent.bgPanel} ${accent.text} ring-1 ring-white/10`}>
              {activeStep.id === "projects" ? <FolderOpen className="h-5 w-5" /> : activeStep.id === "docker" ? <Box className="h-5 w-5" /> : activeStep.id === "chat" ? <MessageCircle className="h-5 w-5" /> : <Compass className="h-5 w-5" />}
            </div>
            <div>
              <h2 className="font-display text-2xl font-black leading-none tracking-tight">{activeStep.title}</h2>
              <p className="mt-3 text-sm font-medium leading-relaxed text-slate-300">{activeStep.body}</p>
            </div>
          </div>

          <div className="mt-5 overflow-hidden rounded-full bg-white/10">
            <div
              className={`h-1.5 rounded-full ${accent.bg} shadow-[0_0_18px_rgba(0,224,160,0.45)] transition-[width] duration-100`}
              style={{ width: `${reducedMotion ? 0 : progress}%` }}
            />
          </div>

          <div className="mt-5 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={hideTour}
              className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold uppercase tracking-[0.12em] text-slate-400 transition-colors hover:bg-white/8 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50"
            >
              <EyeOff className="h-3.5 w-3.5" />
              Hide
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={activeIndex === 0}
                onClick={goPrevious}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.06] text-slate-300 transition-colors hover:bg-white/[0.1] hover:text-white disabled:cursor-not-allowed disabled:opacity-35 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50"
                aria-label="Previous tour step"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={isLast ? hideTour : goNext}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-xs font-black uppercase tracking-[0.12em] text-void-950 transition-transform hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50"
              >
                {isLast ? (
                  <>
                    <Check className="h-4 w-4" />
                    Done
                  </>
                ) : (
                  <>
                    Next
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
