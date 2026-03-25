import { useEffect, useRef } from "preact/hooks";
import type { FunctionComponent } from "preact";
import { X } from "lucide-preact";
import type { QuicksprintTemplateRecord } from "../../../../../src/contracts/quicksprint-types.js";

interface QuicksprintPromptModalProps {
  template: QuicksprintTemplateRecord;
  onClose: () => void;
}

export const QuicksprintPromptModal: FunctionComponent<QuicksprintPromptModalProps> = ({ template, onClose }) => {
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div
        ref={modalRef}
        className="relative flex flex-col w-full max-w-3xl max-h-[85vh] bg-void-900 border border-white/[0.06] rounded-xl shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06]">
          <div>
            <h2 className="text-lg font-bold text-white">Full Prompt</h2>
            <p className="text-sm text-gray-400">Template: {template.name}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-white rounded-md hover:bg-white/10 transition-colors"
            title="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 bg-void-900/50">
          <pre className="text-sm font-mono text-gray-300 whitespace-pre-wrap break-words">
            {template.agentInstructionMarkdown}
          </pre>
        </div>
      </div>
    </div>
  );
};
