import type { FunctionComponent } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import gsap from "gsap";
import { ChevronRight, FileText, Plus } from "lucide-preact";
import type { InstructionFileSummary } from "../../lib/instruction-file-api.js";
import { ProviderBrandIcon } from "../providers/ProviderBrandIcon.js";
import { getInstructionAccentHex, formatBytes } from "../../lib/instruction-file-display.js";

export const InstructionFileCard: FunctionComponent<{
  file: InstructionFileSummary;
  isSelected: boolean;
  onClick: () => void;
}> = ({ file, isSelected, onClick }) => {
  const cardRef = useRef<HTMLButtonElement>(null);
  const accentHex = getInstructionAccentHex(file.providerId);

  useLayoutEffect(() => {
    if (!cardRef.current) return;
    gsap.fromTo(
      cardRef.current,
      { opacity: 0, y: 14, scale: 0.98 },
      { opacity: 1, y: 0, scale: 1, duration: 0.5, ease: "power3.out" },
    );
  }, []);

  return (
    <button
      ref={cardRef}
      type="button"
      onClick={onClick}
      className={`group relative flex w-full overflow-hidden rounded-[1.4rem] border text-left backdrop-blur-xl transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2 ${
        isSelected
          ? "border-signal-500/40 bg-white/85 shadow-[0_8px_32px_rgba(0,224,160,0.12)] dark:border-signal-500/40 dark:bg-void-800/75 dark:shadow-[0_8px_32px_rgba(0,224,160,0.10)]"
          : file.exists
            ? "border-black/[0.06] bg-white/55 hover:-translate-y-0.5 hover:border-signal-500/30 hover:bg-white/80 hover:shadow-[0_8px_24px_rgba(0,224,160,0.06)] dark:border-white/[0.06] dark:bg-void-800/40 dark:hover:border-signal-500/30 dark:hover:bg-void-800/60 dark:hover:shadow-[0_8px_24px_rgba(0,0,0,0.25)]"
            : "border-dashed border-black/[0.1] bg-white/30 hover:-translate-y-0.5 hover:border-signal-500/40 hover:bg-white/55 hover:shadow-[0_4px_16px_rgba(0,0,0,0.04)] dark:border-white/[0.1] dark:bg-void-800/25 dark:hover:border-signal-500/40 dark:hover:bg-void-800/45 dark:hover:shadow-[0_4px_16px_rgba(0,0,0,0.2)]"
      }`}
    >
      {/* Left accent strip */}
      <div
        className={`absolute inset-y-0 left-0 w-[3px] rounded-l-full transition-opacity duration-300 ${isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-50"}`}
        style={{ backgroundColor: accentHex }}
      />

      <div className="relative z-10 flex w-full items-center gap-4 px-5 py-4">
        {/* Document tile with provider brand badge */}
        <div
          className={`relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl transition-shadow duration-300 ${isSelected ? "shadow-[0_0_16px_rgba(0,224,160,0.12)]" : ""}`}
          style={{ background: `linear-gradient(135deg, ${accentHex}1f, ${accentHex}0a)` }}
        >
          <FileText
            className={file.exists ? "h-6 w-6" : "h-6 w-6 opacity-60"}
            style={{ color: accentHex }}
            strokeWidth={1.8}
          />
          {file.providerId && (
            <ProviderBrandIcon
              id={file.providerId}
              className="absolute -bottom-1 -right-1 h-5 w-5 rounded-md border-white/70 shadow-sm dark:border-void-800/70"
              imageClassName="h-3 w-3"
            />
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <h3
            className={`font-display text-[15px] font-bold tracking-tight transition-colors ${
              isSelected
                ? "text-slate-900 dark:text-white"
                : "text-slate-700 dark:text-slate-300 group-hover:text-slate-900 dark:group-hover:text-white"
            }`}
          >
            {file.label}
          </h3>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate font-mono text-[9px] text-slate-400 dark:text-slate-500">
              {file.relativePath}
            </span>
            <span
              className={`ml-auto inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.1em] ${
                file.exists
                  ? "border-signal-500/20 bg-signal-500/8 text-signal-600 dark:text-signal-400"
                  : "border-black/[0.06] bg-black/[0.03] text-slate-400 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-500"
              }`}
            >
              {file.exists ? formatBytes(file.size) : (<><Plus className="h-2.5 w-2.5" strokeWidth={2.6} />New</>)}
            </span>
          </div>
        </div>

        <ChevronRight
          className={`h-4 w-4 shrink-0 transition-all duration-300 ${
            isSelected ? "translate-x-0.5 text-signal-500" : "text-slate-300 group-hover:translate-x-0.5 group-hover:text-signal-400 dark:text-slate-600"
          }`}
          strokeWidth={2.5}
        />
      </div>
    </button>
  );
};
