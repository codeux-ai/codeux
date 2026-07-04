import type { FunctionComponent } from "preact";
import { Link } from "@tanstack/react-router";
import { ArrowRight, FolderGit2, ListChecks, Plus } from "lucide-preact";
import { Button } from "../ui/Button.js";

export type TaskScopePlaceholderMode = "project" | "sprint";

export interface TaskScopePlaceholderProps {
  mode: TaskScopePlaceholderMode;
  hasProjects: boolean;
  onAddProject: () => void;
}

export const TaskScopePlaceholder: FunctionComponent<TaskScopePlaceholderProps> = ({
  mode,
  hasProjects,
  onAddProject,
}) => {
  const isProjectMode = mode === "project";
  const title = isProjectMode ? "Task work starts with a project." : "Create a sprint to unlock tasks.";
  const eyebrow = isProjectMode ? "Task Board Standby" : "Sprint Scope Required";
  const body = isProjectMode
    ? "Connect a project before the task board starts tracking queued work, active implementation, QA review, and completed delivery."
    : "Tasks are organized inside sprint scope. Create or select a sprint before adding implementation work to the board.";

  return (
    <section className="relative overflow-hidden rounded-[2.2rem] border border-black/[0.06] bg-white/72 p-8 shadow-[0_18px_48px_rgba(15,23,42,0.07)] backdrop-blur-2xl dark:border-white/[0.06] dark:bg-void-800/62 dark:shadow-[0_18px_48px_rgba(0,0,0,0.28)] md:p-10">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_72%_58%_at_48%_25%,rgba(0,224,160,0.09),transparent_64%)] dark:bg-[radial-gradient(ellipse_72%_58%_at_48%_25%,rgba(0,224,160,0.13),transparent_64%)]" />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="h-52 w-52 rounded-full border border-signal-500/14 animate-[ping_5.8s_cubic-bezier(0.1,0.5,0.8,1)_infinite]" />
        <div className="absolute h-80 w-80 rounded-full border border-ember-500/10 animate-[ping_8.4s_cubic-bezier(0.1,0.5,0.8,1)_infinite]" />
        <div className="absolute h-[28rem] w-[28rem] rounded-full border border-black/[0.035] animate-[ping_11s_cubic-bezier(0.1,0.5,0.8,1)_infinite] dark:border-white/[0.04]" />
      </div>

      <div className="relative z-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-center">
        <div>
          <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-[1.35rem] border border-signal-500/20 bg-signal-500/10 text-signal-500 shadow-[0_0_32px_rgba(0,224,160,0.16)]">
            <ListChecks className="h-7 w-7" strokeWidth={1.7} />
          </div>
          <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-signal-500">
            {eyebrow}
          </div>
          <h1 className="mt-3 max-w-3xl font-display text-4xl font-black leading-[0.98] tracking-tight text-slate-900 dark:text-white md:text-5xl">
            {title}
          </h1>
          <p className="mt-5 max-w-2xl text-sm font-medium leading-relaxed text-slate-500 dark:text-slate-400 md:text-base">
            {body}
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            {isProjectMode ? (
              <Button
                type="button"
                onClick={onAddProject}
                variant="signal"
                icon={Plus}
                className="!inline-flex !min-h-[44px] !items-center !gap-2.5 !rounded-full !px-5 !py-2.5 !text-[10px] !font-bold !uppercase !tracking-[0.14em] !shadow-[0_10px_30px_rgba(0,224,160,0.22)] hover:!-translate-y-px focus-visible:!ring-2 focus-visible:!ring-signal-500/40"
              >
                {hasProjects ? "Add Project" : "Add First Project"}
              </Button>
            ) : (
              <Link
                to="/sprints"
                className="inline-flex min-h-[44px] items-center gap-2.5 rounded-full bg-signal-500 px-5 py-2.5 text-[10px] font-bold uppercase tracking-[0.14em] text-void-900 shadow-[0_10px_30px_rgba(0,224,160,0.22)] transition-all hover:-translate-y-px hover:bg-signal-400 focus-visible:ring-2 focus-visible:ring-signal-500/40"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2.3} />
                Plan Sprint
              </Link>
            )}
            <Link
              to={isProjectMode ? "/projects" : "/sprints"}
              className="inline-flex min-h-[44px] items-center gap-2.5 rounded-full border border-black/[0.06] bg-white/75 px-5 py-2.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-600 transition-all hover:-translate-y-px hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-signal-500/40 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-300 dark:hover:text-white"
            >
              <FolderGit2 className="h-3.5 w-3.5 text-ember-500" strokeWidth={2.1} />
              {isProjectMode ? "Manage Projects" : "Open Sprints"}
              <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.1} />
            </Link>
          </div>
        </div>

        <div className="relative overflow-hidden rounded-[1.7rem] border border-black/[0.06] bg-black/[0.025] p-5 dark:border-white/[0.06] dark:bg-white/[0.035]">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_85%_65%_at_50%_0%,rgba(255,184,0,0.12),transparent_68%)]" />
          <div className="relative z-10 space-y-3">
            {[
              { label: "Project", value: isProjectMode ? "required" : "ready", tone: isProjectMode ? "text-ember-500" : "text-status-green" },
              { label: "Sprint", value: isProjectMode ? "waiting" : "required", tone: isProjectMode ? "text-signal-500" : "text-ember-500" },
              { label: "Tasks", value: "locked", tone: "text-slate-500 dark:text-slate-400" },
            ].map((item, index) => (
              <div
                key={item.label}
                className="rounded-[1.15rem] border border-white/60 bg-white/72 p-4 shadow-sm dark:border-white/[0.06] dark:bg-white/[0.04]"
              >
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-slate-400">{item.label}</div>
                    <div className={`mt-1 text-xs font-bold uppercase tracking-[0.12em] ${item.tone}`}>{item.value}</div>
                  </div>
                  <div className={`h-2.5 w-2.5 rounded-full ${index === 0 ? "bg-ember-500" : index === 1 ? "bg-signal-500" : "bg-slate-300 dark:bg-slate-600"}`}>
                    <span className="block h-full w-full rounded-full animate-ping bg-current opacity-40" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};
