import type { FunctionComponent } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { ArrowUp, MessageCircle } from "lucide-preact";
import { useProjectData } from "../../context/project-data.js";
import { useProjectEffectiveSettings } from "../../hooks/use-project-effective-settings.js";
import { fetchAgentPresets } from "../../lib/agent-preset-api.js";
import { AgentAvatarSvg } from "../agents/AgentAvatarSvg.js";
import { generateRandomAgentAvatar } from "../../lib/agent-avatar.js";
import type { AgentAvatarConfig, AgentPreset } from "../../types.js";
import { CHAT_DRAFT_QUERY_PARAM } from "../../lib/no-project-chat-assistant.js";

const fallbackAvatar = generateRandomAgentAvatar("Code UX");

export const DashboardAssistantWidget: FunctionComponent = () => {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { selectedProject } = useProjectData();
  const { data: effectiveSettings } = useProjectEffectiveSettings(selectedProject?.id || null);
  const [agentPresets, setAgentPresets] = useState<AgentPreset[]>([]);
  const [input, setInput] = useState("");
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    if (!selectedProject?.id) {
      setAgentPresets([]);
      return;
    }

    let cancelled = false;
    fetchAgentPresets(selectedProject.id)
      .then((presets) => {
        if (!cancelled) setAgentPresets(presets);
      })
      .catch(() => {
        if (!cancelled) setAgentPresets([]);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedProject?.id]);

  const dashboardReplyAgent = useMemo(() => {
    const agentPresetId = effectiveSettings?.settings.agents.routing.dashboardReply.agentPresetId;
    const configuredAgent = agentPresetId
      ? agentPresets.find((preset) => preset.id === agentPresetId)
      : null;
    return configuredAgent
      ?? agentPresets.find((preset) => preset.name.trim().toLowerCase() === "project manager")
      ?? null;
  }, [agentPresets, effectiveSettings?.settings.agents.routing.dashboardReply.agentPresetId]);

  const avatarConfig: AgentAvatarConfig = dashboardReplyAgent?.avatarConfig ?? fallbackAvatar;
  const assistantLabel = dashboardReplyAgent?.name ?? "Project manager";

  if (pathname === "/chat") {
    return null;
  }

  const submitDraft = (event: Event): void => {
    event.preventDefault();
    const draft = input.trim();
    if (!draft) {
      setAnnouncement("Type a message before opening chat.");
      return;
    }
    setInput("");
    setAnnouncement("Opening chat with your draft.");
    void navigate({
      to: "/chat",
      search: { [CHAT_DRAFT_QUERY_PARAM]: draft } as any,
    });
  };

  return (
    <aside
      aria-label="Dashboard assistant"
      className="fixed bottom-4 right-4 z-40 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-black/[0.08] bg-white/92 p-3 shadow-[0_18px_54px_rgba(15,23,42,0.16)] backdrop-blur-xl dark:border-white/[0.08] dark:bg-void-800/92 dark:shadow-[0_18px_54px_rgba(0,0,0,0.38)]"
    >
      <div className="mb-2 flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-black/[0.06] bg-white/80 dark:border-white/[0.06] dark:bg-white/[0.05]">
          <AgentAvatarSvg config={avatarConfig} expression="happy" size={36} static />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-signal-500">
            <MessageCircle aria-hidden="true" className="h-3 w-3" strokeWidth={2.4} />
            Assistant
          </div>
          <div className="truncate text-xs font-semibold text-slate-600 dark:text-slate-300">{assistantLabel}</div>
        </div>
      </div>
      <form onSubmit={submitDraft} className="flex items-center gap-2">
        <label htmlFor="dashboard-assistant-widget-input" className="sr-only">Ask dashboard assistant</label>
        <input
          id="dashboard-assistant-widget-input"
          value={input}
          onInput={(event) => setInput(event.currentTarget.value)}
          placeholder="Ask about setup..."
          className="min-h-10 min-w-0 flex-1 rounded-xl border border-black/[0.06] bg-black/[0.025] px-3 text-sm font-medium text-slate-800 outline-none transition focus:border-signal-500/40 focus:bg-white focus-visible:ring-2 focus-visible:ring-signal-500/35 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-white dark:focus:bg-white/[0.065]"
        />
        <button
          type="submit"
          aria-label="Open chat with draft"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-signal-500 text-white shadow-[0_0_20px_rgba(0,224,160,0.24)] transition hover:bg-signal-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/45 disabled:cursor-not-allowed disabled:bg-black/[0.08] disabled:text-slate-400 disabled:shadow-none dark:text-void-900 dark:disabled:bg-white/[0.08]"
          disabled={!input.trim()}
        >
          <ArrowUp aria-hidden="true" className="h-4 w-4" strokeWidth={2.6} />
        </button>
      </form>
      <div role="status" aria-live="polite" className="sr-only">{announcement}</div>
    </aside>
  );
};
