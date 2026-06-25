import type { FunctionComponent } from "preact";
import { Link } from "@tanstack/react-router";
import { Bot, MessageCircle, Plus, Radio, Sparkles } from "lucide-preact";
import { useInteractionTokens } from "../../lib/motion/tokens.js";

type EmptyChatTone = "project" | "thread" | "messages" | "invocations";

const emptyChatTone: Record<EmptyChatTone, {
  eyebrow: string;
  title: string;
  icon: typeof MessageCircle;
  accentClass: string;
}> = {
  project: {
    eyebrow: "Project Required",
    title: "Ready When a Project Exists",
    icon: Plus,
    accentClass: "text-ember-500",
  },
  thread: {
    eyebrow: "Waiting for First Thread",
    title: "Project Chat Is Standing By",
    icon: MessageCircle,
    accentClass: "text-signal-500",
  },
  messages: {
    eyebrow: "Thread Armed",
    title: "No Messages Yet",
    icon: Bot,
    accentClass: "text-signal-500",
  },
  invocations: {
    eyebrow: "No Invocation Selected",
    title: "Runtime Transcript Standby",
    icon: Radio,
    accentClass: "text-ember-500",
  },
};

export const EmptyChat: FunctionComponent<{
  message: string;
  title?: string;
  eyebrow?: string;
  tone?: EmptyChatTone;
}> = ({ message, title, eyebrow, tone = "thread" }) => {
  const config = emptyChatTone[tone];
  const Icon = config.icon;

  return (
    <div className="relative flex h-full min-h-[24rem] items-center justify-center overflow-hidden rounded-[1.9rem] border border-black/[0.06] bg-white/82 p-8 text-center shadow-[0_2px_20px_rgba(0,0,0,0.04)] backdrop-blur-sm dark:border-white/[0.06] dark:bg-void-800/75 dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_55%_at_50%_45%,rgba(0,224,160,0.08),transparent_62%)] dark:bg-[radial-gradient(ellipse_70%_55%_at_50%_45%,rgba(0,224,160,0.11),transparent_62%)]" />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="h-44 w-44 rounded-full border border-signal-500/16 animate-[ping_4.8s_cubic-bezier(0.1,0.5,0.8,1)_infinite]" />
        <div className="absolute h-72 w-72 rounded-full border border-signal-500/10 animate-[ping_7.2s_cubic-bezier(0.1,0.5,0.8,1)_infinite]" />
        <div className="absolute h-[26rem] w-[26rem] rounded-full border border-ember-500/10 animate-[ping_9.6s_cubic-bezier(0.1,0.5,0.8,1)_infinite]" />
      </div>
      <div className="pointer-events-none absolute left-8 top-8 hidden rounded-full border border-black/[0.06] bg-white/65 px-3 py-1.5 text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400 shadow-sm dark:border-white/[0.06] dark:bg-white/[0.04] sm:flex">
        Queue idle
      </div>

      <div className="relative z-10 w-full max-w-xl">
        <div className="relative mx-auto mb-7 flex h-20 w-20 items-center justify-center">
          <div className="absolute inset-0 rounded-[1.6rem] bg-signal-500/12 blur-[18px] animate-pulse" />
          <div className="absolute inset-2 rounded-[1.4rem] border border-signal-500/20 bg-white/80 shadow-[0_18px_40px_rgba(0,224,160,0.12)] backdrop-blur-xl dark:bg-white/[0.06]" />
          <Icon className={`relative h-8 w-8 ${config.accentClass}`} strokeWidth={1.6} />
        </div>

        <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-signal-500">
          {eyebrow || config.eyebrow}
        </div>
        <h3 className="mt-3 font-display text-3xl font-black tracking-tight text-slate-900 dark:text-white md:text-4xl">
          {title || config.title}
        </h3>
        <p className="mx-auto mt-4 max-w-md text-sm font-medium leading-relaxed text-slate-500 dark:text-slate-400">
          {message}
        </p>

        <div className="mx-auto mt-8 grid max-w-md gap-2 sm:grid-cols-3">
          {[
            { label: "Thread", value: "ready" },
            { label: "Routing", value: "queued" },
            { label: "History", value: "clean" },
          ].map((item) => (
            <div key={item.label} className="rounded-2xl border border-black/[0.06] bg-black/[0.025] px-4 py-3 text-left dark:border-white/[0.06] dark:bg-white/[0.035]">
              <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-slate-400">{item.label}</div>
              <div className="mt-1 text-xs font-bold uppercase tracking-[0.12em] text-slate-700 dark:text-slate-200">{item.value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export const ChatRailPlaceholder: FunctionComponent<{
  title?: string;
  message: string;
  actionLabel?: string;
  actionTo?: string;
}> = ({ title = "Thread Rail Ready", message, actionLabel = "New Thread", actionTo }) => {
  const interactionTokens = useInteractionTokens();

  return (
  <div className="relative flex min-h-[22rem] flex-col justify-between overflow-hidden rounded-[1.5rem] border border-dashed border-signal-500/20 bg-black/[0.025] p-5 dark:bg-white/[0.03]">
    <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_55%_at_50%_0%,rgba(0,224,160,0.12),transparent_62%)]" />
    <div className="relative z-10 space-y-3">
      {[
        { width: "w-4/5", delay: "" },
        { width: "w-2/3", delay: "[animation-delay:160ms]" },
        { width: "w-5/6", delay: "[animation-delay:320ms]" },
      ].map((item, index) => (
        <div key={index} className="rounded-[1.15rem] border border-white/60 bg-white/70 p-3 shadow-sm dark:border-white/[0.06] dark:bg-white/[0.035]">
          <div className="flex items-center gap-3">
            <div className={`h-9 w-9 rounded-xl bg-signal-500/10 ${item.delay} animate-pulse`} />
            <div className="min-w-0 flex-1 space-y-2">
              <div className={`h-2.5 ${item.width} rounded-full bg-slate-200 ${item.delay} animate-pulse dark:bg-white/[0.1]`} />
              <div className={`h-2 w-1/2 rounded-full bg-slate-100 ${item.delay} animate-pulse dark:bg-white/[0.06]`} />
            </div>
          </div>
        </div>
      ))}
    </div>

    <div className="relative z-10 mt-6">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-signal-500/20 bg-signal-500/10 text-signal-500 shadow-[0_0_28px_rgba(0,224,160,0.14)]">
        <Sparkles className="h-5 w-5" strokeWidth={1.7} />
      </div>
      <div className="font-display text-2xl font-black tracking-tight text-slate-900 dark:text-white">{title}</div>
      <p className="mt-2 text-sm font-medium leading-relaxed text-slate-500 dark:text-slate-400">{message}</p>
      {actionTo ? (
        <Link
          to={actionTo}
          style={{
            transitionProperty: "color, background-color, border-color, text-decoration-color, fill, stroke",
            transitionDuration: interactionTokens.controlFeedback.duration,
            transitionTimingFunction: interactionTokens.controlFeedback.ease,
          }}
          className="mt-5 inline-flex min-h-[36px] items-center gap-2 rounded-full border border-signal-500/20 bg-signal-500/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-signal-600 hover:border-signal-500/35 hover:bg-signal-500/15 hover:text-signal-700 focus-visible:ring-2 focus-visible:ring-signal-500/40 dark:text-signal-300"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2.3} />
          {actionLabel}
        </Link>
      ) : (
        <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-signal-500/20 bg-signal-500/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-signal-600 dark:text-signal-300">
          <Plus className="h-3.5 w-3.5" strokeWidth={2.3} />
          {actionLabel}
        </div>
      )}
    </div>
  </div>
  );
};

export const LoadingChat: FunctionComponent<{ label: string }> = ({ label }) => (
  <div className="flex h-full min-h-0 items-center justify-center rounded-[1.9rem] border border-dashed border-black/[0.06] bg-white/70 p-8 text-center shadow-[0_2px_20px_rgba(0,0,0,0.04)] dark:border-white/[0.06] dark:bg-void-800/60 dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
    <div className="space-y-4">
      <div className="mx-auto flex items-center justify-center gap-1.5">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-signal-500" />
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-signal-500 [animation-delay:140ms]" />
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-signal-500 [animation-delay:280ms]" />
      </div>
      <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-signal-500">{label}</div>
      <p className="max-w-md text-sm leading-relaxed text-slate-500 dark:text-slate-400">
        Code UX is loading the latest stored conversation state.
      </p>
    </div>
  </div>
);
