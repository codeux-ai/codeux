import { h, FunctionComponent } from "preact";
import { useMemo } from "preact/hooks";
import { GitPullRequest, RotateCcw } from "lucide-preact";
import { Modal } from "../ui/Modal.js";
import { Row, Toggle } from "./SettingsFormFields.js";
import { MARKDOWN_PROSE_CLASS } from "../ui/MarkdownEditorField.js";
import { renderMarkdown } from "../../../lib/markdown.js";
import type { SettingsPageState } from "../../hooks/use-settings-page-state.js";
import type { SprintPrTemplateSections, TaskPrTemplateSections } from "../../../types.js";
import { SAMPLE_SPRINT_PR_INPUT, SAMPLE_TASK_PR_INPUT } from "../../lib/pr-preview-fixtures.js";
import { composeSprintPrBody, composeTaskPrBody } from "../../../../../src/domain/sprint/composer/pr-description-composer.js";
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

  const sections = kind === "task"
    ? editableSettings?.git.prDescription.task
    : editableSettings?.git.prDescription.sprint;

  const preview = useMemo(() => {
    if (!sections) return "";
    return kind === "task"
      ? composeTaskPrBody({ ...SAMPLE_TASK_PR_INPUT, sections: sections as TaskPrTemplateSections })
      : composeSprintPrBody({ ...SAMPLE_SPRINT_PR_INPUT, sections: sections as SprintPrTemplateSections });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, JSON.stringify(sections)]);

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

  const resetToDefaults = () => {
    updateEditableSettings((current) => ({
      ...current,
      git: {
        ...current.git,
        prDescription: {
          ...current.git.prDescription,
          [kind]: { ...DEFAULT_PR_DESCRIPTION_SETTINGS[kind] },
        },
      },
    }));
  };

  const sectionMeta = kind === "task" ? TASK_SECTIONS : SPRINT_SECTIONS;
  const titleId = `pr-template-editor-title-${kind}`;

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="w-[96vw] max-w-7xl" ariaLabelledBy={titleId}>
      <div className="flex h-[88vh] max-h-[85vh] flex-col">
        <div className="flex items-center gap-3 border-b border-black/[0.06] px-6 py-5 dark:border-white/[0.06]">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-signal-500/10 text-signal-600 dark:text-signal-400">
            <GitPullRequest className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-lg font-bold text-slate-900 dark:text-white">
              {kind === "task" ? "Customize Task PR" : "Customize Sprint PR"}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {kind === "task"
                ? "Choose what appears in the PR opened for each completed task. Preview updates live against sample data."
                : "Choose what appears in the PR opened when a sprint's feature branch merges to main. Preview updates live against sample data."}
            </p>
          </div>
          <button
            type="button"
            onClick={resetToDefaults}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-black/[0.06] bg-black/[0.02] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-slate-600 hover:bg-black/[0.04] dark:border-white/[0.06] dark:text-slate-300 dark:hover:bg-white/[0.06]"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset to defaults
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,22rem)_1fr]">
          <div className="flex flex-col gap-3 overflow-y-auto border-b border-black/[0.06] p-5 dark:border-white/[0.06] md:border-b-0 md:border-r">
            {sectionMeta.map((meta, index) => (
              <Row
                key={String(meta.key)}
                label={meta.label}
                description={meta.description}
                last={index === sectionMeta.length - 1}
              >
                <Toggle
                  aria-label={`Toggle ${meta.label}`}
                  value={Boolean((sections as unknown as Record<string, boolean>)[meta.key as string])}
                  onChange={(value) => setSection(meta.key as string, value)}
                />
              </Row>
            ))}
          </div>
          <div className="min-h-0 overflow-y-auto p-6">
            <div className={MARKDOWN_PROSE_CLASS} dangerouslySetInnerHTML={{ __html: renderMarkdown(preview) }} />
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-black/[0.06] px-6 py-4 dark:border-white/[0.06]">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800 dark:bg-white dark:text-void-900 dark:hover:bg-slate-100"
          >
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
};
