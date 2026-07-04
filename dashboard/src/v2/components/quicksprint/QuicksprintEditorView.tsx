import type { FunctionComponent } from "preact";
import { ChevronLeft, Trash2, Settings2, Zap } from "lucide-preact";
import type { AgentPreset } from "../../types.js";
import { AvantgardeSelect } from "../ui/AvantgardeSelect.js";
import { QUICKSPRINT_FIELD_CLASS, QUICKSPRINT_GLASS_SURFACE, QUICKSPRINT_PRIMARY_ACTION, TAG_STYLES, ICON_OPTIONS, IconMap, getTagStyles } from "./quicksprint-shared.js";
import type { QuicksprintTemplateRecord } from "../../../../../src/contracts/quicksprint-types.js";

export const QuicksprintEditorView: FunctionComponent<{
  agentPresets: AgentPreset[];
  setPhase: (phase: "browse" | "configure" | "editor") => void;
  editorTemplate: QuicksprintTemplateRecord | null;
  edName: string; setEdName: (v: string) => void;
  edDescription: string; setEdDescription: (v: string) => void;
  edIcon: string; setEdIcon: (v: string) => void;
  edCategory: string; setEdCategory: (v: string) => void;
  edCategoryColor: string; setEdCategoryColor: (v: string) => void;
  showColorPicker: boolean; setShowColorPicker: (v: boolean) => void;
  showIconPicker: boolean; setShowIconPicker: (v: boolean) => void;
  iconPickerRef: any;
  colorPickerRef: any;
  pickerPos: { top: number; left: number }; setPickerPos: (v: { top: number; left: number }) => void;
  edInstruction: string; setEdInstruction: (v: string) => void;
  edTaskCount: number; setEdTaskCount: (v: number) => void;
  edAgentPresetId: string; setEdAgentPresetId: (v: string) => void;
  edSaving: boolean;
  edConfirmDelete: boolean;
  handleEditorSave: () => void;
  handleEditorDelete: () => void;
  cardRef: any;
}> = ({
  agentPresets,
  setPhase,
  editorTemplate,
  edName, setEdName,
  edDescription, setEdDescription,
  edIcon, setEdIcon,
  edCategory, setEdCategory,
  edCategoryColor, setEdCategoryColor,
  showColorPicker, setShowColorPicker,
  showIconPicker, setShowIconPicker,
  iconPickerRef, colorPickerRef,
  pickerPos, setPickerPos,
  edInstruction, setEdInstruction,
  edTaskCount, setEdTaskCount,
  edAgentPresetId, setEdAgentPresetId,
  edSaving,
  edConfirmDelete,
  handleEditorSave,
  handleEditorDelete,
  cardRef,
}) => {
  const isNameMissing = !edName.trim();
  const isPromptMissing = !edInstruction.trim() && !edAgentPresetId;
  const isSaveDisabled = edSaving || isNameMissing || isPromptMissing;
  const validationMessage = isNameMissing
    ? "Template name is required."
    : isPromptMissing
      ? "Add agent instructions or choose an agent preset."
      : "";

  return (
    <>
{/* ─── EDITOR PHASE ───────────────────────────────────────── */}
        <div className="p-6 sm:p-8 lg:p-10">
            <div data-qs-stagger className="flex items-center gap-3">
              <button
                onClick={() => setPhase("browse")}
                className="inline-flex min-h-[44px] min-w-[44px] h-8 w-8 items-center justify-center rounded-full border border-black/[0.06] text-slate-400 transition-colors hover:text-slate-900 dark:border-white/[0.06] dark:hover:text-white"
                aria-label="Back to quicksprint templates"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div className="inline-flex items-center gap-2 rounded-full border border-ember-500/15 bg-ember-500/[0.07] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-ember-600 dark:text-ember-400">
                <Settings2 className="h-3.5 w-3.5" strokeWidth={2.3} />
                {editorTemplate ? "Edit Template" : "New Template"}
              </div>
            </div>

            {/* Name */}
            <label data-qs-stagger className="mt-8 block space-y-2">
              <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">Template Name</span>
              <input
                type="text"
                value={edName}
                onInput={(e) => setEdName((e.target as HTMLInputElement).value)}
                placeholder="API Integration Tests"
                aria-invalid={isNameMissing ? "true" : "false"}
                aria-describedby={validationMessage ? "quicksprint-editor-validation" : undefined}
                className={`${QUICKSPRINT_FIELD_CLASS} px-4 py-3 font-display text-[1.65rem] font-black leading-tight tracking-tight text-slate-900 placeholder:text-slate-200 dark:text-white dark:placeholder:text-slate-700 sm:text-[1.9rem]`}
                autoFocus
              />
            </label>

            {/* Description */}
            <label data-qs-stagger className="mt-6 block space-y-2">
              <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">Description</span>
              <input
                type="text"
                value={edDescription}
                onInput={(e) => setEdDescription((e.target as HTMLInputElement).value)}
                placeholder="What this template does in one line"
                className={`${QUICKSPRINT_FIELD_CLASS} px-4 py-3 text-sm leading-relaxed`}
              />
            </label>

            {/* Icon + Color + Category Tag + Default Tasks */}
            <div data-qs-stagger className="mt-8 grid gap-4 sm:grid-cols-2">
              <div className={`p-4 ${QUICKSPRINT_GLASS_SURFACE}`}>
                <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-3">Category Tag</div>
                <div className="flex items-center gap-3">
                  {/* Icon picker trigger */}
                  <button
                    type="button"
                    onClick={(e) => {
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      const container = cardRef.current?.getBoundingClientRect() || { top: 0, left: 0 };
                      setPickerPos({ top: rect.bottom - container.top + 8, left: rect.left - container.left });
                      setShowIconPicker(!showIconPicker);
                      setShowColorPicker(false);
                    }}
                    className="flex min-h-[44px] min-w-[44px] h-10 w-10 flex-shrink-0 cursor-pointer items-center justify-center rounded-xl border border-black/[0.08] bg-white/80 text-slate-600 shadow-sm transition-all duration-200 hover:scale-105 hover:shadow-md hover:border-ember-500/30 hover:text-ember-500 active:scale-95 dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-slate-300 dark:hover:text-ember-400"
                    title="Pick icon"
                    aria-label="Pick template icon"
                  >
                    {(() => { const Ic = IconMap[edIcon] || Zap; return <Ic className="h-5 w-5" />; })()}
                  </button>

                  {/* Color dot picker trigger */}
                  <button
                    type="button"
                    onClick={(e) => {
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      const container = cardRef.current?.getBoundingClientRect() || { top: 0, left: 0 };
                      setPickerPos({ top: rect.bottom - container.top + 8, left: rect.left - container.left });
                      setShowColorPicker(!showColorPicker);
                      setShowIconPicker(false);
                    }}
                    className="flex min-h-[44px] min-w-[44px] h-10 w-10 flex-shrink-0 cursor-pointer items-center justify-center rounded-xl border border-black/[0.08] bg-white/80 shadow-sm transition-all duration-200 hover:scale-105 hover:shadow-md active:scale-95 dark:border-white/[0.08] dark:bg-white/[0.05]"
                    title="Pick tag color"
                    aria-label="Pick category color"
                  >
                    <span
                      className={`block h-5 w-5 rounded-full shadow-[inset_0_1px_2px_rgba(255,255,255,0.4),0_0_0_2px_rgba(0,0,0,0.06)] transition-transform duration-200 ${getTagStyles(edCategoryColor).dot}`}
                      style={getTagStyles(edCategoryColor).style?.["--accent"] ? { backgroundColor: "var(--accent)", ...getTagStyles(edCategoryColor).style } : undefined}
                    />
                  </button>

                  {/* Category text field */}
                  <input
                    type="text"
                    value={edCategory}
                    onInput={(e) => setEdCategory((e.target as HTMLInputElement).value)}
                    placeholder="e.g. engineering..."
                    className={`${QUICKSPRINT_FIELD_CLASS} min-w-0 flex-1 px-3 py-2 text-sm`}
                    aria-label="Category label"
                  />
                </div>

                {/* Live preview tag */}
                {edCategory.trim() && (
                  <div className="mt-3 flex items-center">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold ${getTagStyles(edCategoryColor).bg} ${getTagStyles(edCategoryColor).text}`}
                      style={getTagStyles(edCategoryColor).style?.["--accent"] ? { backgroundColor: "color-mix(in srgb, var(--accent) 15%, transparent)", color: "var(--accent)", ...getTagStyles(edCategoryColor).style } : undefined}
                    >
                      <span
                        className={`block h-1.5 w-1.5 rounded-full ${getTagStyles(edCategoryColor).dot}`}
                        style={getTagStyles(edCategoryColor).style?.["--accent"] ? { backgroundColor: "var(--accent)", ...getTagStyles(edCategoryColor).style } : undefined}
                      />
                      <span className="min-w-0 break-words [overflow-wrap:anywhere]">{edCategory}</span>
                    </span>
                  </div>
                )}
              </div>

              <div className={`p-4 ${QUICKSPRINT_GLASS_SURFACE}`}>
                <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">Default Tasks</div>
                <div className="font-mono text-2xl font-black tracking-tight text-slate-900 dark:text-white">{edTaskCount}</div>
                <input
                  type="range" min="1" max="15" value={edTaskCount}
                  onInput={(e) => setEdTaskCount(parseInt((e.target as HTMLInputElement).value, 10))}
                  className="mt-2 w-full h-1.5 bg-black/[0.06] rounded-full appearance-none cursor-pointer accent-ember-500 dark:bg-white/[0.08]"
                />
              </div>
            </div>

            {/* Picker popups (absolute to section, overflow toggled) */}
            {showIconPicker && (<>
              <div className="fixed inset-0 z-[9998] cursor-pointer" onClick={() => setShowIconPicker(false)} aria-hidden="true" />
              <div
                ref={iconPickerRef}
                role="dialog"
                aria-modal="true"
                aria-label="Icon picker"
                className="absolute z-[9999] w-[17rem] rounded-2xl border border-white/[0.08] p-3 shadow-2xl backdrop-blur-2xl bg-[#1a1d24]/95"
                style={{ top: pickerPos.top, left: pickerPos.left, animation: "qs-picker-in 0.2s cubic-bezier(0.22,1,0.36,1)" }}
              >
                <div className="grid grid-cols-6 gap-1">
                  {ICON_OPTIONS.map((opt) => {
                    const isActive = edIcon === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => { setEdIcon(opt.value); setShowIconPicker(false); }}
                        title={opt.value}
                        aria-label={`Use ${opt.value} icon`}
                        className={`flex min-h-[44px] min-w-[44px] h-9 w-9 cursor-pointer items-center justify-center rounded-xl transition-all duration-150 ${
                          isActive
                            ? "bg-ember-500/20 text-ember-500 shadow-[0_0_10px_rgba(255,107,0,0.15)] scale-110"
                            : "text-slate-400 hover:bg-white/[0.08] hover:text-white hover:scale-110"
                        }`}
                      >
                        <opt.Icon className="h-4 w-4" />
                      </button>
                    );
                  })}
                </div>
              </div>
            </>)}

            {showColorPicker && (<>
              <div className="fixed inset-0 z-[9998] cursor-pointer" onClick={() => setShowColorPicker(false)} aria-hidden="true" />
              <div
                ref={colorPickerRef}
                role="dialog"
                aria-modal="true"
                aria-label="Color picker"
                className="absolute z-[9999] w-52 rounded-2xl border border-white/[0.08] p-3 shadow-2xl backdrop-blur-2xl bg-[#1a1d24]/95"
                style={{ top: pickerPos.top, left: pickerPos.left, animation: "qs-picker-in 0.2s cubic-bezier(0.22,1,0.36,1)" }}
              >
                <div className="grid grid-cols-5 gap-2">
                  {TAG_STYLES.map(({ value, dot }) => {
                    const isActive = value === edCategoryColor;
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => { setEdCategoryColor(value); setShowColorPicker(false); }}
                        aria-label={`Use ${value} category color`}
                        className="group flex min-h-[44px] min-w-[44px] h-8 w-8 cursor-pointer items-center justify-center rounded-full transition-all duration-200 hover:scale-125 active:scale-95"
                      >
                        <span
                          className={`block rounded-full transition-all duration-200 ${dot}`}
                          style={{
                            width: isActive ? "1.5rem" : "1.25rem",
                            height: isActive ? "1.5rem" : "1.25rem",
                            boxShadow: isActive
                              ? `inset 0 1px 3px rgba(255,255,255,0.35), 0 0 0 2.5px rgba(255,255,255,0.2), 0 0 12px rgba(255,255,255,0.15)`
                              : "inset 0 1px 3px rgba(255,255,255,0.35)",
                          }}
                        />
                      </button>
                    );
                  })}
                </div>
              </div>
            </>)}

            {/* Agent Preset */}
            {agentPresets.length > 0 && (
              <div data-qs-stagger className="mt-6">
                <div className={`p-4 ${QUICKSPRINT_GLASS_SURFACE}`}>
                  <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">Agent Preset (optional)</div>
                  <p className="mb-3 break-words text-xs text-slate-400 [overflow-wrap:anywhere] dark:text-slate-500">
                    Attach an agent's instructions to this template. The agent's prompt will be prepended to the template instructions.
                  </p>
                  <AvantgardeSelect
                    variant="compact"
                    value={edAgentPresetId}
                    onChange={(val) => setEdAgentPresetId(val)}
                    options={[
                      { value: "", label: "No Agent" },
                      ...agentPresets.map((p) => ({ value: p.id, label: `${p.name}${p.labels.length ? ` (${p.labels.join(", ")})` : ""}` })),
                    ]}
                    placeholder="No Agent"
                  />
                </div>
              </div>
            )}

            {/* Instructions */}
            <div data-qs-stagger className="mt-6 space-y-2">
              <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">Agent Instructions</span>
              <textarea
                value={edInstruction}
                onInput={(e) => setEdInstruction((e.target as HTMLTextAreaElement).value)}
                placeholder="Write detailed instructions for the planning agent. Leave empty to use only the agent preset's instructions..."
                rows={10}
                aria-invalid={isPromptMissing ? "true" : "false"}
                aria-describedby={validationMessage ? "quicksprint-editor-validation" : undefined}
                className={`${QUICKSPRINT_FIELD_CLASS} min-h-64 resize-y break-words p-5 font-mono text-sm leading-relaxed [overflow-wrap:anywhere]`}
              />
            </div>

            {/* Footer */}
            <div data-qs-stagger className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                {editorTemplate && !editorTemplate.isBuiltIn && (
                  <button
                    type="button"
                    onClick={handleEditorDelete}
                    className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-3.5 py-2 text-[10px] font-bold uppercase tracking-[0.14em] transition-colors ${
                      edConfirmDelete
                        ? "bg-red-600 text-white hover:bg-red-500"
                        : "text-red-400 hover:text-red-300 hover:bg-red-500/10"
                    }`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {edConfirmDelete ? "Confirm Delete" : "Delete"}
                  </button>
                )}
              </div>
              {validationMessage && (
                <div id="quicksprint-editor-validation" className="rounded-full border border-status-red/20 bg-status-red/[0.08] px-3 py-2 text-xs font-semibold text-status-red" role="alert">
                  {validationMessage}
                </div>
              )}
              <button
                onClick={handleEditorSave}
                disabled={isSaveDisabled}
                className={`${QUICKSPRINT_PRIMARY_ACTION} px-6`}
              >
                {edSaving ? "Saving..." : editorTemplate ? "Save Changes" : "Create Template"}
              </button>
            </div>
          </div>

    </>
  );
};
