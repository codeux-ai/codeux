import { useState, useMemo, useEffect, useRef } from "preact/hooks";
import type { FunctionComponent } from "preact";
import { X, Plus } from "lucide-preact";
import gsap from "gsap";
import type { QuicksprintTemplateRecord } from "../../../../../src/contracts/quicksprint-types.js";
import { QuicksprintCard } from "./QuicksprintCard.js";
import { QuicksprintPromptModal } from "./QuicksprintPromptModal.js";

interface QuicksprintPanelProps {
  projectId: string;
  onClose: () => void;
  onExecute: (templateId: string, taskCount: number, submitMode: "plan_only" | "plan_and_start") => Promise<void>;
  templates: QuicksprintTemplateRecord[];
  loading?: boolean;
}

export const QuicksprintPanel: FunctionComponent<QuicksprintPanelProps> = ({
  projectId,
  onClose,
  onExecute,
  templates,
  loading = false,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [taskCount, setTaskCount] = useState<number>(5);
  const [showPromptModal, setShowPromptModal] = useState(false);
  const [executingMode, setExecutingMode] = useState<"plan_only" | "plan_and_start" | null>(null);

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === selectedTemplateId) || null,
    [templates, selectedTemplateId]
  );

  useEffect(() => {
    if (selectedTemplate) {
      setTaskCount(selectedTemplate.defaultTaskCount || 5);
    }
  }, [selectedTemplateId, selectedTemplate]);

  useEffect(() => {
    if (panelRef.current) {
      gsap.fromTo(
        panelRef.current,
        { opacity: 0, y: 20 },
        { opacity: 1, y: 0, duration: 0.4, ease: "power2.out" }
      );
    }
  }, []);

  const handleExecute = async (submitMode: "plan_only" | "plan_and_start") => {
    if (!selectedTemplate) return;
    setExecutingMode(submitMode);
    try {
      await onExecute(selectedTemplate.id, taskCount, submitMode);
    } finally {
      setExecutingMode(null);
    }
  };

  const handleSliderChange = (e: any) => {
    setTaskCount(parseInt(e.target.value, 10));
  };

  const builtinTemplates = templates.filter((t) => t.isBuiltIn);
  const customTemplates = templates.filter((t) => !t.isBuiltIn);

  return (
    <div className="flex flex-col h-full bg-void-900 border border-white/[0.06] rounded-xl overflow-hidden" ref={panelRef}>
      <div className="flex items-center justify-between px-6 py-5 border-b border-white/[0.06]">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            Quicksprint
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-signal-500/10 text-signal-400">BETA</span>
          </h2>
          <p className="text-sm text-gray-400 mt-1">Select a template to rapidly bootstrap a new sprint plan.</p>
        </div>
        <button
          onClick={onClose}
          className="p-2 text-gray-400 hover:text-white rounded-md hover:bg-white/10 transition-colors"
          title="Close panel"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="w-8 h-8 border-2 border-signal-500 border-t-transparent rounded-full animate-spin"></div>
          </div>
        ) : (
          <>
            <div className="mb-8">
              <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">Built-in Templates</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {builtinTemplates.map((template) => (
                  <QuicksprintCard
                    key={template.id}
                    template={template}
                    selected={selectedTemplateId === template.id}
                    onSelect={() => setSelectedTemplateId(template.id)}
                  />
                ))}
              </div>
            </div>

            <div className="mb-8">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Custom Templates</h3>
                <button
                  className="flex items-center gap-1.5 text-xs font-medium text-signal-400 hover:text-signal-300 transition-colors px-2 py-1 rounded hover:bg-signal-500/10"
                  onClick={() => console.log("Add Custom Flow triggered")}
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Custom
                </button>
              </div>

              {customTemplates.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 border border-dashed border-white/[0.08] rounded-xl bg-void-800/30">
                  <p className="text-sm text-gray-500 mb-2">No custom templates yet.</p>
                  <button className="text-sm text-signal-500 hover:underline">
                    Create your first template
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                  {customTemplates.map((template) => (
                    <QuicksprintCard
                      key={template.id}
                      template={template}
                      selected={selectedTemplateId === template.id}
                      onSelect={() => setSelectedTemplateId(template.id)}
                      onEdit={() => console.log("Edit template", template.id)}
                      onDelete={() => console.log("Delete template", template.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {selectedTemplate && (
        <div className="border-t border-white/[0.06] bg-void-800/80 p-6 shadow-[0_-10px_40px_rgba(0,0,0,0.3)]">
          <div className="max-w-4xl mx-auto">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
              <div className="flex-1 min-w-0 w-full">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-lg font-bold text-white truncate pr-4">
                    {selectedTemplate.name}
                  </h3>
                  <button
                    onClick={() => setShowPromptModal(true)}
                    className="text-xs text-signal-400 hover:text-signal-300 underline underline-offset-2 whitespace-nowrap"
                  >
                    View Full Prompt
                  </button>
                </div>

                <div className="bg-void-900 border border-white/[0.06] rounded-lg p-4 mt-3">
                  <div className="flex items-center justify-between mb-3">
                    <label htmlFor="taskCountSlider" className="text-sm font-medium text-gray-300">
                      Target Subtask Count
                    </label>
                    <div className="bg-void-800 px-3 py-1 rounded text-white font-mono text-sm border border-white/10">
                      {taskCount} subtask{taskCount !== 1 ? 's' : ''}
                    </div>
                  </div>

                  <div className="relative pt-1">
                    <input
                      id="taskCountSlider"
                      type="range"
                      min="1"
                      max="15"
                      value={taskCount}
                      onChange={handleSliderChange}
                      aria-label="Target subtask count"
                      aria-valuemin={1}
                      aria-valuemax={15}
                      aria-valuenow={taskCount}
                      className="w-full h-2 bg-void-700 rounded-lg appearance-none cursor-pointer accent-signal-500 focus:outline-none focus:ring-2 focus:ring-signal-500/50"
                    />
                    <div className="flex justify-between text-[10px] text-gray-500 mt-2 px-1">
                      <span>1</span>
                      <span>5</span>
                      <span>10</span>
                      <span>15</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto mt-4 md:mt-0 pt-2 md:pt-0">
                <button
                  onClick={() => handleExecute("plan_only")}
                  disabled={executingMode !== null}
                  className="px-5 py-2.5 rounded-lg border border-white/[0.12] text-white font-medium hover:bg-white/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-w-[120px]"
                >
                  {executingMode === "plan_only" ? "Planning..." : "Plan Only"}
                </button>
                <button
                  onClick={() => handleExecute("plan_and_start")}
                  disabled={executingMode !== null}
                  className="px-5 py-2.5 rounded-lg bg-signal-600 hover:bg-signal-500 text-white font-medium shadow-[0_0_15px_rgba(var(--color-signal-500),0.3)] transition-all disabled:opacity-50 disabled:cursor-not-allowed min-w-[140px]"
                >
                  {executingMode === "plan_and_start" ? "Starting..." : "Plan & Start"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showPromptModal && selectedTemplate && (
        <QuicksprintPromptModal
          template={selectedTemplate}
          onClose={() => setShowPromptModal(false)}
        />
      )}
    </div>
  );
};
