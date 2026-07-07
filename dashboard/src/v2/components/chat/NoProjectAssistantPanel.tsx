import type { FunctionComponent } from "preact";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { ArrowRight, BookOpen, FolderPlus, Settings, Sparkles } from "lucide-preact";
import { LazyAgentAvatarScene } from "../agents/LazyAgentAvatarScene.js";
import type { AgentAvatarConfig } from "../../types.js";
import { generateRandomAgentAvatar } from "../../lib/agent-avatar.js";
import { openOnboarding } from "../../lib/onboarding-control.js";
import {
  ASSISTANT_OPEN_ADD_PROJECT_EVENT,
  createNoProjectAssistantReply,
  NO_PROJECT_ASSISTANT_PROMPTS,
  type NoProjectAssistantAction,
  type NoProjectAssistantPromptId,
} from "../../lib/no-project-chat-assistant.js";

type LocalTurn = {
  id: string;
  role: "user" | "assistant";
  body: string;
  actions?: NoProjectAssistantAction[];
};

const defaultAvatar = generateRandomAgentAvatar("Code UX");

const actionIcon = (action: NoProjectAssistantAction) => {
  if (action.kind === "open-add-project") return FolderPlus;
  if (action.id === "open-settings") return Settings;
  if (action.id.includes("docs") || action.id.includes("quickstart")) return BookOpen;
  return ArrowRight;
};

const openAddProject = (): void => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(ASSISTANT_OPEN_ADD_PROJECT_EVENT));
};

const AssistantActionButton: FunctionComponent<{ action: NoProjectAssistantAction }> = ({ action }) => {
  const Icon = actionIcon(action);
  const className = "inline-flex min-h-10 items-center gap-2 rounded-xl border border-signal-500/25 bg-signal-500/10 px-3 py-2 text-left text-xs font-bold text-signal-700 transition hover:border-signal-500/45 hover:bg-signal-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/45 dark:text-signal-300";

  if (action.kind === "route" && action.to) {
    return (
      <Link to={action.to} aria-label={`${action.label}. ${action.description}`} className={className}>
        <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" strokeWidth={2.3} />
        {action.label}
      </Link>
    );
  }

  return (
    <button
      type="button"
      aria-label={`${action.label}. ${action.description}`}
      onClick={action.kind === "open-onboarding" ? openOnboarding : openAddProject}
      className={className}
    >
      <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" strokeWidth={2.3} />
      {action.label}
    </button>
  );
};

export const NoProjectAssistantPanel: FunctionComponent<{
  initialDraft?: string | null;
  onInitialDraftConsumed?: () => void;
  avatarConfig?: AgentAvatarConfig;
}> = ({ initialDraft, onInitialDraftConsumed, avatarConfig = defaultAvatar }) => {
  const [turns, setTurns] = useState<LocalTurn[]>(() => [{
    id: "assistant-welcome",
    role: "assistant",
    body: "I can help you get Code UX ready before a project exists. Choose a quick prompt, then use the explicit buttons for project creation, settings, onboarding, or docs.",
    actions: [NO_PROJECT_ASSISTANT_PROMPTS[0].actions[0], NO_PROJECT_ASSISTANT_PROMPTS[3].actions[0]],
  }]);
  const [announcement, setAnnouncement] = useState("No-project assistant ready.");
  const consumedDraftRef = useRef<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const addLocalTurn = (body: string, promptId: NoProjectAssistantPromptId | null = null): void => {
    const reply = createNoProjectAssistantReply(body);
    const timestamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setTurns((current) => [
      ...current,
      { id: `user-${promptId ?? "draft"}-${timestamp}`, role: "user", body },
      { id: `assistant-${reply.matchedPromptId ?? promptId ?? "draft"}-${timestamp}`, role: "assistant", body: reply.body, actions: reply.actions },
    ]);
    setAnnouncement("Assistant reply added. Use the action buttons to continue.");
  };

  useEffect(() => {
    const draft = initialDraft?.trim();
    if (!draft || consumedDraftRef.current === draft) {
      return;
    }
    consumedDraftRef.current = draft;
    addLocalTurn(draft);
    onInitialDraftConsumed?.();
  }, [initialDraft, onInitialDraftConsumed]);

  useEffect(() => {
    if (!logRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [turns]);

  const promptButtons = useMemo(() => NO_PROJECT_ASSISTANT_PROMPTS.map((prompt) => (
    <button
      key={prompt.id}
      type="button"
      onClick={() => addLocalTurn(prompt.prompt, prompt.id)}
      className="group min-h-12 rounded-2xl border border-black/[0.06] bg-white/82 px-4 py-3 text-left text-sm font-semibold text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:border-signal-500/30 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/45 motion-reduce:transform-none dark:border-white/[0.06] dark:bg-white/[0.045] dark:text-slate-200 dark:hover:bg-white/[0.07]"
    >
      <span className="flex items-center justify-between gap-3">
        <span>{prompt.label}</span>
        <Sparkles aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-signal-500 opacity-70 transition group-hover:opacity-100" strokeWidth={2.2} />
      </span>
    </button>
  )), []);

  return (
    <section
      aria-labelledby="no-project-assistant-title"
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border border-black/[0.06] bg-white/78 shadow-[0_2px_20px_rgba(0,0,0,0.04)] backdrop-blur-sm dark:border-white/[0.06] dark:bg-void-800/72 dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]"
    >
      <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[minmax(260px,0.72fr)_minmax(0,1.28fr)]">
        <div className="relative overflow-hidden border-b border-black/[0.05] p-6 dark:border-white/[0.05] lg:border-b-0 lg:border-r">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_65%_at_50%_30%,rgba(0,224,160,0.12),transparent_66%)]" />
          <div className="relative z-10 flex h-full min-h-[24rem] flex-col">
            <div>
              <div className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-signal-500">No project selected</div>
              <h2 id="no-project-assistant-title" className="mt-3 font-display text-3xl font-semibold leading-tight tracking-tight text-slate-950 dark:text-white">
                Start with the assistant.
              </h2>
              <p className="mt-3 max-w-md text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                This local onboarding chat does not create conversation threads or call project chat APIs.
              </p>
            </div>
            <div className="mt-6 flex min-h-0 flex-1 items-center justify-center">
              <LazyAgentAvatarScene
                config={avatarConfig}
                expression="curious"
                className="h-[min(42vh,24rem)] min-h-[220px] w-full"
              />
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-col">
          <div
            ref={logRef}
            role="log"
            aria-label="No-project assistant replies"
            aria-live="polite"
            aria-relevant="additions"
            className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5 sm:px-6"
          >
            {turns.map((turn) => (
              <div key={turn.id} className={`flex ${turn.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[760px] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm ${
                  turn.role === "user"
                    ? "bg-slate-900 text-white dark:bg-white dark:text-void-900"
                    : "border border-black/[0.06] bg-white/86 text-slate-700 dark:border-white/[0.06] dark:bg-white/[0.045] dark:text-slate-200"
                }`}>
                  <p>{turn.body}</p>
                  {turn.actions && turn.actions.length > 0 && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {turn.actions.map((action) => <AssistantActionButton key={action.id} action={action} />)}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-black/[0.05] p-5 dark:border-white/[0.05]">
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
              {promptButtons}
            </div>
            <div role="status" aria-live="polite" className="sr-only">
              {announcement}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
