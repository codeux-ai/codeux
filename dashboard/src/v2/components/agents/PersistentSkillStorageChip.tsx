import type { FunctionComponent } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { AlertCircle, Library, LoaderCircle, RotateCcw } from "lucide-preact";
import type {
  SkillStorageContentSummary,
  SkillStorageContentsResponse,
} from "../../../../../src/contracts/skill-types.js";
import type { SkillStorageRecord } from "../../types.js";
import { fetchSkillStorageContents } from "../../lib/agent-preset-api.js";
import { Tooltip } from "../ui/Tooltip.js";

const MAX_VISIBLE_SKILLS = 4;
const MAX_VISIBLE_TAGS = 3;
const MAX_PREVIEW_CHARS = 180;

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; contents: SkillStorageContentsResponse }
  | { status: "error" };

const truncatePreview = (value: string): { text: string; truncated: boolean } => {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= MAX_PREVIEW_CHARS) {
    return { text: normalized, truncated: false };
  }
  return {
    text: `${normalized.slice(0, MAX_PREVIEW_CHARS - 1).trimEnd()}…`,
    truncated: true,
  };
};

const SkillSummary: FunctionComponent<{ skill: SkillStorageContentSummary }> = ({ skill }) => {
  const preview = truncatePreview(skill.contentPreview);
  const visibleTags = skill.tags.slice(0, MAX_VISIBLE_TAGS);
  const hiddenTagCount = skill.tags.length - visibleTags.length;

  return (
    <li className="rounded-xl border border-black/[0.06] bg-black/[0.025] p-3 dark:border-white/[0.07] dark:bg-white/[0.035]">
      <div className="min-w-0 text-xs font-bold text-slate-800 dark:text-slate-100" title={skill.name}>
        <span className="block truncate">{skill.name}</span>
      </div>
      {skill.description ? (
        <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
          {skill.description}
        </p>
      ) : null}
      {visibleTags.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1" aria-label={`Tags for ${skill.name}`}>
          {visibleTags.map((tag) => (
            <span
              key={tag}
              className="max-w-28 truncate rounded-full bg-signal-500/[0.1] px-2 py-0.5 text-[9px] font-bold text-signal-700 dark:text-signal-200"
              title={tag}
            >
              {tag}
            </span>
          ))}
          {hiddenTagCount > 0 ? (
            <span className="text-[9px] font-bold text-slate-400">+{hiddenTagCount} tags</span>
          ) : null}
        </div>
      ) : null}
      {preview.text ? (
        <div className="mt-2 rounded-lg bg-white/70 px-2.5 py-2 font-mono text-[10px] leading-relaxed text-slate-600 dark:bg-black/20 dark:text-slate-300">
          <p>{preview.text}</p>
          {preview.truncated ? (
            <span className="mt-1 block font-sans text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400">
              Preview truncated
            </span>
          ) : null}
        </div>
      ) : null}
    </li>
  );
};

const StorageDisclosure: FunctionComponent<{
  storage: SkillStorageRecord;
  state: LoadState;
}> = ({ storage, state }) => {
  if (state.status === "idle" || state.status === "loading") {
    return (
      <div className="flex min-h-24 w-[min(22rem,calc(100vw-2rem))] items-center justify-center gap-2 text-xs text-slate-500 dark:text-slate-300" aria-live="polite">
        <LoaderCircle className="h-4 w-4 animate-spin text-signal-500" aria-hidden="true" />
        Loading storage contents…
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="w-[min(22rem,calc(100vw-2rem))]" aria-live="polite">
        <div className="flex items-center gap-2 text-xs font-bold text-status-red">
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          Couldn’t load storage contents
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-slate-500 dark:text-slate-300">
          Hover or focus the chip again, or press Enter while it is focused, to retry.
        </p>
      </div>
    );
  }

  const { contents } = state;
  const visibleSkills = contents.skills.slice(0, MAX_VISIBLE_SKILLS);
  const hiddenLoadedCount = contents.skills.length - visibleSkills.length;
  const skillCount = `${contents.skills.length}${contents.truncated ? "+" : ""}`;

  return (
    <div className="max-h-[min(32rem,calc(100vh-2rem))] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto" aria-live="polite">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-bold text-slate-900 dark:text-white" title={storage.name}>
            {storage.name}
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-300">
            {contents.storage.description || storage.description || "No storage description."}
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-signal-500/20 bg-signal-500/[0.08] px-2 py-1 text-[9px] font-bold uppercase tracking-[0.12em] text-signal-700 dark:text-signal-200">
          {skillCount} {contents.skills.length === 1 && !contents.truncated ? "skill" : "skills"}
        </span>
      </div>

      {visibleSkills.length === 0 ? (
        <div className="mt-3 rounded-xl border border-dashed border-black/[0.08] bg-black/[0.02] px-3 py-4 text-center text-[11px] text-slate-500 dark:border-white/[0.08] dark:bg-white/[0.025] dark:text-slate-400">
          No skills saved in this storage.
        </div>
      ) : (
        <ul className="mt-3 space-y-2">
          {visibleSkills.map((skill) => <SkillSummary key={skill.id} skill={skill} />)}
        </ul>
      )}

      {hiddenLoadedCount > 0 ? (
        <p className="mt-3 text-[10px] font-semibold text-slate-500 dark:text-slate-400">
          {hiddenLoadedCount} more loaded skill{hiddenLoadedCount === 1 ? "" : "s"} hidden from this preview.
        </p>
      ) : null}
      {contents.truncated ? (
        <p className="mt-1 text-[10px] font-semibold text-slate-500 dark:text-slate-400">
          More skills are available beyond this bounded response.
        </p>
      ) : null}
    </div>
  );
};

export const PersistentSkillStorageChip: FunctionComponent<{
  storage: SkillStorageRecord;
  attached?: boolean;
  className?: string;
  onActivate?: () => void;
}> = ({ storage, attached = true, className = "", onActivate }) => {
  const [state, setState] = useState<LoadState>({ status: "idle" });
  const requestInFlight = useRef(false);
  const storageKey = `${storage.projectId}:${storage.id}`;
  const previousStorageKey = useRef(storageKey);
  const activeStorageKey = useRef(storageKey);

  useEffect(() => {
    if (previousStorageKey.current === storageKey) return;
    previousStorageKey.current = storageKey;
    activeStorageKey.current = storageKey;
    requestInFlight.current = false;
    setState({ status: "idle" });
  }, [storageKey]);

  const loadContents = useCallback((): void => {
    if (!attached || requestInFlight.current || state.status === "loaded") return;

    const requestedStorageKey = storageKey;
    requestInFlight.current = true;
    setState({ status: "loading" });
    void fetchSkillStorageContents(storage.projectId, storage.id)
      .then((contents) => {
        if (activeStorageKey.current === requestedStorageKey) {
          setState({ status: "loaded", contents });
        }
      })
      .catch(() => {
        if (activeStorageKey.current === requestedStorageKey) {
          setState({ status: "error" });
        }
      })
      .finally(() => {
        if (activeStorageKey.current === requestedStorageKey) {
          requestInFlight.current = false;
        }
      });
  }, [attached, state.status, storage.id, storage.projectId, storageKey]);

  const chipClasses = `inline-flex min-w-0 max-w-[min(16rem,calc(100vw-3rem))] items-center gap-1.5 rounded-full border border-signal-500/20 bg-signal-500/[0.08] px-2.5 py-1 text-[11px] font-bold text-signal-700 dark:text-signal-200 ${className}`;

  if (!attached) {
    return (
      <span className={chipClasses} title={storage.name}>
        <Library className="h-3 w-3 shrink-0" aria-hidden="true" />
        <span className="truncate">{storage.name}</span>
      </span>
    );
  }

  return (
    <Tooltip
      position="top"
      delay={0}
      unstyled
      className="rounded-2xl border border-black/[0.08] bg-white/95 p-4 shadow-[0_18px_48px_rgba(15,23,42,0.18)] backdrop-blur-2xl dark:border-white/[0.08] dark:bg-void-800/95 dark:shadow-[0_18px_48px_rgba(0,0,0,0.45)]"
      content={<StorageDisclosure storage={storage} state={state} />}
    >
      <button
        type="button"
        className={`${chipClasses} cursor-help transition-colors hover:border-signal-500/35 hover:bg-signal-500/[0.13] focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30`}
        onPointerEnter={loadContents}
        onFocusCapture={loadContents}
        onClick={() => {
          if (state.status === "error") {
            loadContents();
          } else if (onActivate) {
            onActivate();
          }
        }}
        aria-label={`Inspect attached skill storage ${storage.name}`}
        title={storage.name}
      >
        {state.status === "loading" ? (
          <LoaderCircle className="h-3 w-3 shrink-0 animate-spin" aria-hidden="true" />
        ) : state.status === "error" ? (
          <RotateCcw className="h-3 w-3 shrink-0" aria-hidden="true" />
        ) : (
          <Library className="h-3 w-3 shrink-0" aria-hidden="true" />
        )}
        <span className="truncate">{storage.name}</span>
      </button>
    </Tooltip>
  );
};
