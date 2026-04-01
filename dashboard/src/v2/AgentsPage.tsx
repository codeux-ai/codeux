import type { FunctionComponent } from "preact";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import { Bot, Plus, Brain, AlertTriangle, RefreshCw, FileUp, Trash2, Tags, Save } from "lucide-preact";
import type { AgentPreset } from "./types.js";
import { useProjectData } from "./context/project-data.js";
import {
  createAgentPreset,
  deleteAgentPreset,
  fetchAgentPresets,
  importAgentPresetFromMarkdown,
  syncAllAgentPresetsFromMarkdown,
  updateAgentPreset,
} from "./lib/agent-preset-api.js";
import { useProjectEffectiveSettings } from "./hooks/use-project-effective-settings.js";
import { generateRandomAgentAvatar } from "./lib/agent-avatar.js";
import { WaveFluid } from "./components/ui/WaveFluid.js";
import { BorderTrace } from "./components/ui/BorderTrace.js";
import { AgentsHero } from "./components/agents/AgentsHero.js";
import { AgentPresetShowcaseCard } from "./components/agents/AgentPresetShowcaseCard.js";
import { AgentPresetDetailPanel } from "./components/agents/AgentPresetDetailPanel.js";
import { AgentPresetEditorPanel } from "./components/agents/AgentPresetEditorPanel.js";

const EmptyState: FunctionComponent<{ hasProject: boolean; onCreate?: () => void }> = ({ hasProject, onCreate }) => (
  <div className="relative overflow-hidden rounded-[2rem] border border-dashed border-signal-500/25 bg-white/70 p-8 text-center shadow-[0_2px_20px_rgba(0,0,0,0.04)] dark:bg-void-800/60 dark:border-signal-500/20 dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
    <WaveFluid accentHex="#00E0A0" />
    <BorderTrace accentHex="#00E0A0" />
    <div className="relative z-10 flex flex-col items-center gap-4">
      <div className="flex h-14 w-14 items-center justify-center rounded-[1.25rem] bg-signal-500/10 text-signal-500">
        <Bot className="h-6 w-6" strokeWidth={1.6} />
      </div>
      <h3 className="font-display text-2xl font-black tracking-tight text-slate-900 dark:text-white">
        {hasProject ? "No Agent Presets Yet" : "Select A Project"}
      </h3>
      <p className="max-w-xl text-sm leading-relaxed text-slate-500 dark:text-slate-400">
        {hasProject
          ? "Create reusable agent definitions with instructions and labels. Agents stay separate from live connections and can now sync from `.sprint-os/agents/*.md`."
          : "Choose a project from the top navigation to manage its project agents."}
      </p>
      {hasProject && onCreate && (
        <button
          type="button"
          onClick={onCreate}
          className="inline-flex items-center gap-2 rounded-full bg-signal-500 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-void-900 transition-colors hover:bg-signal-400"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2.3} />
          New Agent
        </button>
      )}
    </div>
  </div>
);

const syncStatusTone = (preset: AgentPreset): { badge: string; label: string } => {
  switch (preset.syncStatus) {
    case "out_of_sync":
      return {
        badge: "border-amber-500/30 bg-amber-500/12 text-amber-700 dark:text-amber-300",
        label: "Out of Sync",
      };
    case "missing_source":
      return {
        badge: "border-status-red/25 bg-status-red/10 text-status-red",
        label: "Source Missing",
      };
    case "synced":
      return {
        badge: "border-signal-500/25 bg-signal-500/10 text-signal-600 dark:text-signal-400",
        label: preset.sourceScope === "project"
          ? "Project Markdown"
          : preset.sourceScope === "default"
            ? "Default Markdown"
            : "Home Markdown",
      };
    default:
      return {
        badge: "border-black/[0.08] bg-black/[0.04] text-slate-500 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-400",
        label: "Database Only",
      };
  }
};

const splitLabels = (value: string): string[] => (
  value
    .split(",")
    .map((label) => label.trim())
    .filter(Boolean)
);

const AgentPresetCard: FunctionComponent<{
  preset: AgentPreset;
  saving: boolean;
  deleting: boolean;
  importing: boolean;
  onSave: (presetId: string, next: { name: string; labels: string[]; instructionMarkdown: string }) => Promise<void>;
  onDelete: (presetId: string) => Promise<void>;
  onImport: (presetId: string) => Promise<void>;
}> = ({ preset, saving, deleting, importing, onSave, onDelete, onImport }) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const [name, setName] = useState(preset.name);
  const [labels, setLabels] = useState(preset.labels.join(", "));
  const [instructionMarkdown, setInstructionMarkdown] = useState(preset.instructionMarkdown);
  const syncTone = syncStatusTone(preset);

  useEffect(() => {
    setName(preset.name);
    setLabels(preset.labels.join(", "));
    setInstructionMarkdown(preset.instructionMarkdown);
  }, [preset.id, preset.name, preset.labels, preset.instructionMarkdown]);

  useLayoutEffect(() => {
    if (!cardRef.current) return;
    gsap.fromTo(
      cardRef.current,
      { opacity: 0, y: 36, scale: 0.97 },
      { opacity: 1, y: 0, scale: 1, duration: 0.7, ease: "power3.out" }
    );
  }, []);

  return (
    <div
      ref={cardRef}
      className="group relative overflow-hidden rounded-[1.85rem] border border-black/[0.06] bg-white/70 p-7 shadow-[0_2px_20px_rgba(0,0,0,0.04)] backdrop-blur-2xl dark:border-white/[0.06] dark:bg-void-800/60 dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]"
    >
      <WaveFluid accentHex="#00E0A0" />
      <BorderTrace accentHex="#00E0A0" />

      <div className="relative z-10 flex flex-col gap-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-[1rem] bg-signal-500/10 text-signal-500">
              <Brain className="h-5 w-5" strokeWidth={1.6} />
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-signal-500">Agent</div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] ${syncTone.badge}`}>
                  {preset.syncStatus === "out_of_sync" && <AlertTriangle className="h-3 w-3" strokeWidth={2.1} />}
                  {syncTone.label}
                </span>
                <span className="font-mono text-[10px] text-slate-400">
                  Updated {new Date(preset.updatedAt).toLocaleDateString()}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {preset.sourcePath && (
              <button
                type="button"
                onClick={() => void onImport(preset.id)}
                disabled={importing || preset.syncStatus === "manual"}
                className="inline-flex items-center gap-2 rounded-full border border-signal-500/20 bg-signal-500/10 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-signal-600 transition-colors hover:bg-signal-500/20 disabled:cursor-not-allowed disabled:opacity-70 dark:text-signal-300"
                title={preset.syncStatus === "out_of_sync" ? "Import updated markdown" : "Re-import markdown"}
              >
                {importing ? <RefreshCw className="h-3.5 w-3.5 animate-spin" strokeWidth={2.1} /> : <FileUp className="h-3.5 w-3.5" strokeWidth={2.1} />}
                Import
              </button>
            )}
            <button
              type="button"
              onClick={() => void onDelete(preset.id)}
              disabled={deleting}
              className="inline-flex items-center gap-2 rounded-full border border-status-red/20 bg-status-red/10 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-status-red transition-colors hover:bg-status-red/20 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {deleting ? <RefreshCw className="h-3.5 w-3.5 animate-spin" strokeWidth={2.1} /> : <Trash2 className="h-3.5 w-3.5" strokeWidth={2.1} />}
              Delete
            </button>
          </div>
        </div>

        <label className="space-y-2">
          <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-slate-400">Agent Name</span>
          <input
            value={name}
            onInput={(event) => setName((event.target as HTMLInputElement).value)}
            className="w-full rounded-[1.2rem] border border-black/[0.08] bg-black/[0.03] px-4 py-3 text-sm text-slate-700 outline-none transition-colors focus:border-signal-500 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-200"
            placeholder="Planning agent"
          />
        </label>

        <label className="space-y-2">
          <span className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-[0.16em] text-slate-400">
            <Tags className="h-3.5 w-3.5" strokeWidth={2} />
            Labels
          </span>
          <input
            value={labels}
            onInput={(event) => setLabels((event.target as HTMLInputElement).value)}
            className="w-full rounded-[1.2rem] border border-black/[0.08] bg-black/[0.03] px-4 py-3 text-sm text-slate-700 outline-none transition-colors focus:border-signal-500 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-200"
            placeholder="planning, review, worker"
          />
        </label>

        <label className="space-y-2">
          <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-slate-400">Instruction Markdown</span>
          <textarea
            value={instructionMarkdown}
            onInput={(event) => setInstructionMarkdown((event.target as HTMLTextAreaElement).value)}
            rows={9}
            className="min-h-[220px] w-full rounded-[1.2rem] border border-black/[0.08] bg-black/[0.03] px-4 py-3 text-sm leading-relaxed text-slate-700 outline-none transition-colors focus:border-signal-500 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-200"
            placeholder="Describe how this preset should plan, communicate, or execute work."
          />
        </label>

        {preset.sourcePath && (
          <div className="rounded-[1.25rem] border border-black/[0.06] bg-black/[0.025] px-4 py-3 text-xs leading-relaxed text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-400">
            <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-slate-400">Markdown Source</div>
            <div className="mt-2 break-all font-mono text-[11px]">{preset.sourcePath}</div>
          </div>
        )}

        <div className="flex items-center justify-between border-t border-black/[0.05] pt-4 text-[10px] font-mono dark:border-white/[0.05]">
          <span className="truncate text-slate-400">{preset.id}</span>
          <button
            type="button"
            onClick={() => void onSave(preset.id, { name, labels: splitLabels(labels), instructionMarkdown })}
            disabled={saving || !name.trim()}
            className="inline-flex items-center gap-2 rounded-full bg-signal-500 px-4 py-2 font-bold uppercase tracking-[0.12em] text-void-900 transition-all hover:bg-signal-400 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {saving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" strokeWidth={2.1} /> : <Save className="h-3.5 w-3.5" strokeWidth={2.1} />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
};

export const AgentsPage: FunctionComponent = () => {
  const headerRef = useRef<HTMLDivElement>(null);
  const { selectedProject, loading: projectLoading } = useProjectData();
  const [presets, setPresets] = useState<AgentPreset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [syncingAll, setSyncingAll] = useState(false);
  const [projectFileSavingEnabled, setProjectFileSavingEnabled] = useState(true);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const { data: effectiveSettings } = useProjectEffectiveSettings(selectedProject?.id || null);

  useEffect(() => {
    if (effectiveSettings) {
      setProjectFileSavingEnabled(effectiveSettings.settings.agents.saveToProjectDirectory);
    } else if (!selectedProject) {
      setProjectFileSavingEnabled(true);
    }
  }, [effectiveSettings, selectedProject]);

  const refreshPresets = async (): Promise<void> => {
    if (!selectedProject) {
      setPresets([]);
      setError(null);
      return;
    }
    setLoading(true);
    try {
      const nextPresets = await fetchAgentPresets(selectedProject.id);
      setPresets(nextPresets);

      if (!selectedPresetId && nextPresets.length > 0) {
        setSelectedPresetId(nextPresets[0].id);
      } else if (selectedPresetId && !nextPresets.find((p) => p.id === selectedPresetId)) {
        setSelectedPresetId(nextPresets.length > 0 ? nextPresets[0].id : null);
        setIsEditing(false);
      }

      setError(null);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshPresets();
  }, [selectedProject?.id]);

  useLayoutEffect(() => {
    if (!headerRef.current) return;
    gsap.fromTo(
      Array.from(headerRef.current.children),
      { opacity: 0, y: 34 },
      { opacity: 1, y: 0, duration: 0.85, stagger: 0.08, ease: "power4.out" }
    );
  }, []);

  const stats = useMemo(() => ({
    total: presets.length,
    withLabels: presets.filter((preset) => preset.labels.length > 0).length,
    withInstructions: presets.filter((preset) => preset.instructionMarkdown.trim().length > 0).length,
    outOfSync: presets.filter((preset) => preset.syncStatus === "out_of_sync").length,
  }), [presets]);

  const handleCreate = async (): Promise<void> => {
    if (!selectedProject) {
      return;
    }

    try {
      const created = await createAgentPreset(selectedProject.id, {
        name: `Agent ${presets.length + 1}`,
        instructionMarkdown: "",
        labels: [],
        avatarConfig: generateRandomAgentAvatar(Date.now().toString()),
      });
      setPresets((current) => [created, ...current]);
      setSelectedPresetId(created.id);
      setIsEditing(true);
      setError(null);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError));
    }
  };

  const handleImport = async (presetId: string): Promise<void> => {
    setImportingId(presetId);
    try {
      const updated = await importAgentPresetFromMarkdown(presetId);
      setPresets((current) => current.map((preset) => preset.id === updated.id ? updated : preset));
      setError(null);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : String(importError));
    } finally {
      setImportingId(null);
    }
  };

  const handleSyncAll = async (): Promise<void> => {
    if (!selectedProject) {
      return;
    }

    setSyncingAll(true);
    try {
      setPresets(await syncAllAgentPresetsFromMarkdown(selectedProject.id));
      setError(null);
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : String(syncError));
    } finally {
      setSyncingAll(false);
    }
  };

  const handleSave = async (
    presetId: string,
    next: Parameters<typeof updateAgentPreset>[1],
  ): Promise<void> => {
    setSavingId(presetId);
    try {
      const updated = await updateAgentPreset(presetId, next);
      setPresets((current) => current.map((preset) => preset.id === updated.id ? updated : preset));
      setIsEditing(false);
      setError(null);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : String(updateError));
    } finally {
      setSavingId(null);
    }
  };

  const handleDelete = async (presetId: string): Promise<void> => {
    setDeletingId(presetId);
    try {
      await deleteAgentPreset(presetId);
      setPresets((current) => {
        const next = current.filter((p) => p.id !== presetId);
        if (selectedPresetId === presetId) {
          setSelectedPresetId(next.length > 0 ? next[0].id : null);
          setIsEditing(false);
        }
        return next;
      });
      setError(null);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    } finally {
      setDeletingId(null);
    }
  };

  const selectedPreset = presets.find((p) => p.id === selectedPresetId);

  return (
    <div className="relative z-10 mx-auto flex max-w-[1880px] flex-col gap-12 px-8 py-20 md:px-20">
      <AgentsHero
        selectedProject={selectedProject}
        projectLoading={projectLoading}
        loading={loading}
        syncingAll={syncingAll}
        presets={presets}
        onSyncAll={() => void handleSyncAll()}
        onCreate={() => void handleCreate()}
      />

      {error && (
        <div className="rounded-[1.5rem] border border-status-red/20 bg-status-red/10 px-5 py-4 text-sm text-status-red">
          {error}
        </div>
      )}

      {selectedProject && (
        <div className="rounded-[1.5rem] border border-black/[0.06] bg-white/60 px-5 py-4 text-sm leading-relaxed text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-400">
          {projectFileSavingEnabled
            ? "Project markdown mirroring is enabled. Saving an agent from the dashboard writes its markdown companion under `.sprint-os/agents` for this project."
            : "Project markdown mirroring is disabled for this project. Dashboard edits stay in the database, but local `.sprint-os/agents` markdown is still discovered and can be imported."}
        </div>
      )}

      {!selectedProject ? (
        <EmptyState hasProject={false} />
      ) : presets.length === 0 && !loading ? (
        <EmptyState hasProject onCreate={() => void handleCreate()} />
      ) : presets.length > 0 ? (
        <div className="flex flex-col gap-8 xl:flex-row xl:items-start">
          <div className="flex w-full flex-col gap-4 xl:w-1/3 xl:shrink-0">
            {presets.map((preset) => (
              <AgentPresetShowcaseCard
                key={preset.id}
                preset={preset}
                isSelected={selectedPresetId === preset.id}
                onClick={() => {
                  setSelectedPresetId(preset.id);
                  setIsEditing(false);
                }}
              />
            ))}
          </div>

          <div className="w-full flex-1">
            {selectedPreset && (
              isEditing ? (
                <AgentPresetEditorPanel
                  preset={selectedPreset}
                  saving={savingId === selectedPreset.id}
                  onSave={handleSave}
                  onCancel={() => setIsEditing(false)}
                />
              ) : (
                <AgentPresetDetailPanel
                  preset={selectedPreset}
                  onEdit={() => setIsEditing(true)}
                  onDelete={handleDelete}
                  onImport={handleImport}
                  deleting={deletingId === selectedPreset.id}
                  importing={importingId === selectedPreset.id}
                />
              )
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
};
