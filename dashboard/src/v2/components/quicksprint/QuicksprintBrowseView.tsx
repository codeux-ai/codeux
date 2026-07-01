import type { FunctionComponent } from "preact";
import { Search, Compass, X, Sparkles, Plus, Zap } from "lucide-preact";
import type { QuicksprintTemplateRecord } from "../../../../../src/contracts/quicksprint-types.js";
import { TemplateCard } from "./quicksprint-shared.js";
import { AvantgardeSelect } from "../ui/AvantgardeSelect.js";
import type { BuiltinPurposeOption } from "../../lib/quicksprint-panel-state.js";

export const QuicksprintBrowseView: FunctionComponent<{
  templates: QuicksprintTemplateRecord[];
  builtinTemplates: QuicksprintTemplateRecord[];
  customTemplates: QuicksprintTemplateRecord[];
  visibleBuiltinTemplates: QuicksprintTemplateRecord[];
  builtinPurposeOptions: BuiltinPurposeOption[];
  selectedBuiltinPurpose: string;
  setSelectedBuiltinPurpose: (purpose: string) => void;
  handleSelectTemplate: (t: QuicksprintTemplateRecord) => void;
  openEditor: (t: QuicksprintTemplateRecord | null) => void;
  activeBuiltinPurpose: BuiltinPurposeOption | null;
  loading: boolean;
  onClose: () => void;
}> = ({
  builtinTemplates,
  customTemplates,
  visibleBuiltinTemplates,
  builtinPurposeOptions,
  selectedBuiltinPurpose,
  setSelectedBuiltinPurpose,
  handleSelectTemplate,
  activeBuiltinPurpose,
  loading,
  openEditor,
  onClose,
}) => {
  return (

        <div className="p-6 sm:p-8 lg:p-10">
            {/* Header */}
            <div data-qs-stagger className="flex items-start justify-between gap-4">
              <div className="space-y-4">
                <div className="inline-flex items-center gap-2 rounded-full border border-ember-500/15 bg-ember-500/[0.07] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-ember-600 dark:text-ember-400">
                  <Zap className="h-3.5 w-3.5" strokeWidth={2.3} />
                  Quicksprint
                </div>
                <div className="space-y-3">
                  <h2 className="font-display text-[2rem] font-black leading-none tracking-tight text-slate-900 dark:text-white sm:text-[2.35rem]">
                    Launch A Quicksprint.
                  </h2>
                  <p className="max-w-2xl text-sm leading-relaxed text-slate-500 dark:text-slate-400 sm:text-[15px]">
                    Browse purpose-specific default templates or launch your own reusable custom flows to spin up a focused sprint fast.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex min-h-[44px] min-w-[44px] h-10 w-10 shrink-0 items-center justify-center rounded-full border border-black/[0.06] bg-white/78 text-slate-400 transition-colors hover:text-slate-900 dark:border-white/[0.06] dark:bg-white/[0.03] dark:hover:text-white"
                aria-label="Close quicksprint"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-20">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-ember-500 border-t-transparent" />
              </div>
            ) : (
              <>
                {/* Built-in templates */}
                <div data-qs-stagger className="mt-10">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                    <div className="space-y-2">
                      <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400">Default Templates</div>
                      <p className="max-w-2xl text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                        Built-in templates are organized by purpose so the catalog can expand into additional language and product families over time.
                      </p>
                    </div>
                    <div className="w-full max-w-sm rounded-[1.4rem] border border-black/[0.06] bg-black/[0.025] p-4 dark:border-white/[0.06] dark:bg-white/[0.03]">
                      <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400">Purpose</div>
                      <div className="mt-2">
                        <AvantgardeSelect
                          aria-label="Default template purpose"
                          variant="compact"
                          value={activeBuiltinPurpose?.value || ""}
                          onChange={setSelectedBuiltinPurpose}
                          options={builtinPurposeOptions.map((option) => ({
                            value: option.value,
                            label: option.label,
                          }))}
                          placeholder="Select Purpose"
                        />
                      </div>
                    </div>
                  </div>
                  {activeBuiltinPurpose?.description && (
                    <p className="mt-4 max-w-3xl text-xs leading-relaxed text-slate-400 dark:text-slate-500">
                      {activeBuiltinPurpose.description}
                    </p>
                  )}
                  <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {visibleBuiltinTemplates.map((t) => (
                      <TemplateCard key={t.id} template={t} onSelect={() => handleSelectTemplate(t)} />
                    ))}
                  </div>
                </div>

                {/* Custom templates */}
                <div data-qs-stagger className="mt-10">
                  <div className="flex items-center justify-between mb-5">
                    <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">Custom Templates</div>
                    <button
                      onClick={() => openEditor(null)}
                      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-ember-500/20 bg-ember-500/[0.06] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-ember-600 transition-colors hover:bg-ember-500/[0.12] dark:text-ember-400"
                    >
                      <Plus className="h-3 w-3" strokeWidth={2.5} />
                      New Template
                    </button>
                  </div>

                  {customTemplates.length === 0 ? (
                    <button
                      onClick={() => openEditor(null)}
                      className="w-full rounded-[1.4rem] border border-dashed border-black/[0.08] bg-black/[0.015] p-8 text-center transition-colors hover:border-ember-500/30 hover:bg-ember-500/[0.03] dark:border-white/[0.06] dark:bg-white/[0.02] dark:hover:border-ember-500/30"
                    >
                      <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-ember-500/10">
                        <Plus className="h-5 w-5 text-ember-500" />
                      </div>
                      <div className="text-sm font-semibold text-slate-500 dark:text-slate-400">Create your first custom template</div>
                      <div className="mt-1 text-xs text-slate-400 dark:text-slate-500">Combine agent presets with custom prompts for reusable sprint flows</div>
                    </button>
                  ) : (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                      {customTemplates.map((t) => (
                        <TemplateCard key={t.id} template={t} onSelect={() => handleSelectTemplate(t)} onEdit={() => openEditor(t)} />
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

  );
};
