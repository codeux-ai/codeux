import { h, FunctionComponent } from "preact";
import { useMemo, useState } from "preact/hooks";
import { createPortal } from "preact/compat";
import { GitPullRequest, GripVertical, RotateCcw } from "lucide-preact";
import { Modal } from "../ui/Modal.js";
import { Toggle } from "./SettingsFormFields.js";
import { MARKDOWN_PROSE_CLASS } from "../ui/MarkdownEditorField.js";
import { renderMarkdown } from "../../../lib/markdown.js";
import type { SettingsPageState } from "../../hooks/use-settings-page-state.js";
import type { SprintPrTemplateSections, TaskPrTemplateSections } from "../../../types.js";
import { SAMPLE_SPRINT_PR_INPUT, SAMPLE_TASK_PR_INPUT } from "../../lib/pr-preview-fixtures.js";
import {
  composeSprintPrBody,
  composeTaskPrBody,
  resolveSectionOrder,
  DEFAULT_TASK_SECTION_ORDER,
  DEFAULT_SPRINT_SECTION_ORDER,
} from "../../../../../src/domain/sprint/composer/pr-description-composer.js";
import { DEFAULT_PR_DESCRIPTION_SETTINGS } from "../../../../../src/repositories/settings-defaults.js";

interface SectionMeta<TSections> {
  key: keyof TSections;
  label: string;
  description: string;
}

const TASK_SECTIONS: SectionMeta<TaskPrTemplateSections>[] = [
  { key: "summary", label: "Summary", description: "Task and sprint context blurb." },
  { key: "modelAndProvider", label: "Model & Provider", description: "Which provider and model executed this task." },
  { key: "timing", label: "Timing", description: "Started, finished, and duration." },
  { key: "fullPrompt", label: "Full Prompt", description: "The task's full prompt, shown collapsed by default." },
  { key: "tokenUsage", label: "Token Usage", description: "Token counts and estimated cost. Subscription (flat-fee login) usage is called out separately from metered API usage." },
  { key: "qaFindings", label: "QA Review", description: "QA outcome and findings, once available. QA runs after this PR opens, so it shows a pending note until then." },
  { key: "branchInfo", label: "Branch Info", description: "Base/head branch reference, shown collapsed." },
];

const SPRINT_SECTIONS: SectionMeta<SprintPrTemplateSections>[] = [
  { key: "summary", label: "Summary", description: "Task completion counts for the sprint." },
  { key: "taskChecklist", label: "Task Checklist", description: "Per-task checklist with provider and PR links." },
  { key: "providerBreakdown", label: "Provider Breakdown", description: "Count of completed tasks per provider." },
  { key: "planningModel", label: "Planning", description: "Model/provider used to plan the sprint, plus its token usage." },
  { key: "mainPrompt", label: "Original Prompt", description: "The sprint's original goal/prompt, shown collapsed." },
  { key: "timing", label: "Sprint Timing", description: "Sprint start, finish, and duration." },
  { key: "tokenUsage", label: "Aggregate Token Usage", description: "Total CLI token usage/cost across the whole sprint. Subscription usage is called out separately from metered API usage." },
  { key: "qaFindings", label: "QA Review Summary", description: "Sprint-level QA outcome and findings." },
  { key: "branchInfo", label: "Branch Info", description: "Base/head branch reference, shown collapsed." },
];

interface PrTemplateEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  kind: "task" | "sprint";
  state: SettingsPageState;
}

export const PrTemplateEditorModal: FunctionComponent<PrTemplateEditorModalProps> = ({ isOpen, onClose, kind, state }) => {
  const { editableSettings, updateEditableSettings } = state;
  const [draggedKey, setDraggedKey] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  const orderFieldName = kind === "task" ? "taskSectionOrder" : "sprintSectionOrder";
  const defaultOrder = kind === "task" ? DEFAULT_TASK_SECTION_ORDER : DEFAULT_SPRINT_SECTION_ORDER;
  const sectionMeta = kind === "task" ? TASK_SECTIONS : SPRINT_SECTIONS;
  const sectionMetaByKey = useMemo(
    () => new Map(sectionMeta.map((meta) => [String(meta.key), meta])),
    [sectionMeta],
  );

  const sections = kind === "task"
    ? editableSettings?.git.prDescription.task
    : editableSettings?.git.prDescription.sprint;

  const storedOrder = editableSettings?.git.prDescription[orderFieldName];
  const order = useMemo(
    () => resolveSectionOrder(storedOrder as string[] | undefined, defaultOrder as string[]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(storedOrder), kind],
  );

  const preview = useMemo(() => {
    if (!sections) return "";
    return kind === "task"
      ? composeTaskPrBody({ ...SAMPLE_TASK_PR_INPUT, sections: sections as TaskPrTemplateSections, sectionOrder: order as (keyof TaskPrTemplateSections)[] })
      : composeSprintPrBody({ ...SAMPLE_SPRINT_PR_INPUT, sections: sections as SprintPrTemplateSections, sectionOrder: order as (keyof SprintPrTemplateSections)[] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, JSON.stringify(sections), JSON.stringify(order)]);

  if (!editableSettings || !sections) {
    return null;
  }

  const setSection = (key: string, value: boolean) => {
    updateEditableSettings((current) => ({
      ...current,
      git: {
        ...current.git,
        prDescription: {
          ...current.git.prDescription,
          [kind]: {
            ...current.git.prDescription[kind],
            [key]: value,
          },
        },
      },
    }));
  };

  const setOrder = (newOrder: string[]) => {
    updateEditableSettings((current) => ({
      ...current,
      git: {
        ...current.git,
        prDescription: {
          ...current.git.prDescription,
          [orderFieldName]: newOrder,
        },
      },
    }));
  };

  const resetToDefaults = () => {
    updateEditableSettings((current) => ({
      ...current,
      git: {
        ...current.git,
        prDescription: {
          ...current.git.prDescription,
          [kind]: { ...DEFAULT_PR_DESCRIPTION_SETTINGS[kind] },
          [orderFieldName]: [...defaultOrder],
        },
      },
    }));
  };

  const handleDrop = (targetKey: string) => {
    if (!draggedKey || draggedKey === targetKey) {
      setDraggedKey(null);
      setDragOverKey(null);
      return;
    }
    const withoutDragged = order.filter((k) => k !== draggedKey);
    const targetIndex = withoutDragged.indexOf(targetKey);
    const nextOrder = [
      ...withoutDragged.slice(0, targetIndex),
      draggedKey,
      ...withoutDragged.slice(targetIndex),
    ];
    setOrder(nextOrder);
    setDraggedKey(null);
    setDragOverKey(null);
  };

  const titleId = `pr-template-editor-title-${kind}`;

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="relative z-[300]">
      <Modal isOpen={isOpen} onClose={onClose} className="w-[96vw] max-w-7xl" ariaLabelledBy={titleId}>
        <div className="flex h-[80vh] flex-col">
          <div className="flex items-center gap-3 border-b border-black/[0.06] bg-gradient-to-b from-black/[0.015] to-transparent px-6 py-5 dark:border-white/[0.06] dark:from-white/[0.02]">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-signal-500/10 text-signal-600 dark:text-signal-400">
              <GitPullRequest className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-lg font-bold text-slate-900 dark:text-white">
                {kind === "task" ? "Customize Task PR" : "Customize Sprint PR"}
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {kind === "task"
                  ? "Choose what appears — and in what order — in the PR opened for each completed task. Preview updates live against sample data."
                  : "Choose what appears — and in what order — in the PR opened when a sprint's feature branch merges to main. Preview updates live against sample data."}
              </p>
            </div>
            <button
              type="button"
              onClick={resetToDefaults}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-black/[0.06] bg-black/[0.02] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-slate-600 transition-colors hover:bg-black/[0.05] dark:border-white/[0.06] dark:text-slate-300 dark:hover:bg-white/[0.08]"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset to defaults
            </button>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,23rem)_1fr]">
            <div className="flex flex-col gap-2 overflow-y-auto border-b border-black/[0.06] bg-black/[0.01] p-4 dark:border-white/[0.06] dark:bg-white/[0.01] md:border-b-0 md:border-r">
              <div className="mb-1 flex items-center justify-between px-1">
                <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">Sections</span>
                <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500">Drag to reorder</span>
              </div>
              {order.map((key, index) => {
                const meta = sectionMetaByKey.get(key);
                if (!meta) return null;
                const isEnabled = Boolean((sections as unknown as Record<string, boolean>)[key]);
                const isDragging = draggedKey === key;
                const isDragOver = dragOverKey === key && draggedKey !== null && draggedKey !== key;

                return (
                  <div
                    key={key}
                    draggable
                    onDragStart={(e: DragEvent) => {
                      setDraggedKey(key);
                      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragOver={(e: DragEvent) => {
                      e.preventDefault();
                      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
                      if (dragOverKey !== key) setDragOverKey(key);
                    }}
                    onDrop={(e: DragEvent) => {
                      e.preventDefault();
                      handleDrop(key);
                    }}
                    onDragEnd={() => {
                      setDraggedKey(null);
                      setDragOverKey(null);
                    }}
                    className={`group flex items-center gap-2.5 rounded-[1.1rem] border px-3 py-3 transition-all duration-150 ${
                      isDragging
                        ? "border-signal-500/30 bg-signal-500/[0.06] opacity-50"
                        : isDragOver
                          ? "border-signal-500/40 bg-signal-500/[0.08] shadow-[0_0_0_1px_rgba(0,224,160,0.15)]"
                          : isEnabled
                            ? "border-black/[0.06] bg-white/70 hover:border-black/[0.1] hover:bg-white dark:border-white/[0.06] dark:bg-void-800/40 dark:hover:bg-void-800/70"
                            : "border-black/[0.04] bg-black/[0.015] opacity-60 hover:opacity-90 dark:border-white/[0.04] dark:bg-white/[0.01]"
                    }`}
                  >
                    <div
                      className="flex shrink-0 cursor-grab items-center text-slate-300 transition-colors active:cursor-grabbing group-hover:text-slate-400 dark:text-slate-600 dark:group-hover:text-slate-500"
                      aria-hidden="true"
                    >
                      <GripVertical className="h-4 w-4" />
                    </div>
                    <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-black/[0.04] text-[10px] font-bold text-slate-500 dark:bg-white/[0.06] dark:text-slate-400">
                      {index + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className={`text-sm font-semibold ${isEnabled ? "text-slate-800 dark:text-slate-100" : "text-slate-500 dark:text-slate-400"}`}>
                        {meta.label}
                      </div>
                      <div className="mt-0.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                        {meta.description}
                      </div>
                    </div>
                    <Toggle
                      aria-label={`Toggle ${meta.label}`}
                      value={isEnabled}
                      onChange={(value) => setSection(key, value)}
                    />
                  </div>
                );
              })}
            </div>
            <div className="min-h-0 overflow-y-auto p-6">
              <div className={MARKDOWN_PROSE_CLASS} dangerouslySetInnerHTML={{ __html: renderMarkdown(preview) }} />
            </div>
          </div>

          <div className="flex justify-end gap-3 border-t border-black/[0.06] px-6 py-4 dark:border-white/[0.06]">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-[rgb(var(--accent-action-rgb)/0.22)] bg-[var(--accent-action)] px-4 py-2 text-sm font-bold text-[var(--accent-on-solid)] shadow-[0_10px_28px_rgb(var(--accent-action-rgb)/0.18)] transition-colors hover:border-[rgb(var(--accent-action-rgb)/0.34)] hover:bg-[var(--accent-action-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-focus-ring)]"
            >
              Close
            </button>
          </div>
        </div>
      </Modal>
    </div>,
    document.body,
  );
};
