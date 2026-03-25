import type { FunctionComponent } from "preact";
import { memo } from "preact/compat";
import { useCallback, useMemo, useState } from "preact/hooks";
import { renderMarkdown } from "../lib/markdown.js";
import type { Subtask } from "../types.js";
import { SessionFeed } from "./ui/task-card/SessionFeed.js";
import { TaskHeader } from "./ui/task-card/TaskHeader.js";
import { TaskMetadata } from "./ui/task-card/TaskMetadata.js";

interface TaskCardProps {
  task: Subtask;
  onRerunTask: (taskId: string) => Promise<void>;
}

export const TaskCard: FunctionComponent<TaskCardProps> = memo(
  ({ task, onRerunTask }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [showLogs, setShowLogs] = useState(false);
    const [isRerunning, setIsRerunning] = useState(false);

    const detailPanelId = `task-details-${task.id}`;
    const livePanelId = `task-live-${task.id}`;
    const hasSession = Boolean(task.session_id || task.session_name);

    const handleRerunTask = useCallback(async (): Promise<void> => {
      const confirmed = window.confirm(
        `Rerun task "${task.id}" now?\n\nThis resets the task state and discards current progress/log context for this card.`
      );
      if (!confirmed) {
        return;
      }
      setIsRerunning(true);
      try {
        await onRerunTask(task.id);
        setShowLogs(false);
        setIsExpanded(false);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to rerun task.";
        window.alert(message);
      } finally {
        setIsRerunning(false);
      }
    }, [task.id, onRerunTask]);

    const handleRerun = useCallback(() => { void handleRerunTask(); }, [handleRerunTask]);
    const handleToggleLogs = useCallback(() => setShowLogs((prev) => !prev), []);
    const handleToggleExpanded = useCallback(() => setIsExpanded((prev) => !prev), []);

    const promptSnippet = task.prompt.substring(0, 120);
    const renderedPrompt = useMemo(() => renderMarkdown(task.prompt), [task.prompt]);

    return (
      <div className="bg-slate-900/50 backdrop-blur-md border border-slate-800 p-5 rounded-2xl hover:bg-slate-900/80 transition-all duration-300 group">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-grow max-w-full overflow-hidden">
            <TaskHeader
              taskId={task.id}
              title={task.title}
              hasSession={hasSession}
              showLogs={showLogs}
              isExpanded={isExpanded}
              isRerunning={isRerunning}
              detailPanelId={detailPanelId}
              livePanelId={livePanelId}
              onToggleLogs={handleToggleLogs}
              onToggleExpanded={handleToggleExpanded}
              onRerun={handleRerun}
            />

            <div className={`transition-all duration-300 ${isExpanded || showLogs ? "h-0 opacity-0 mb-0 overflow-hidden" : "h-6 opacity-100 mb-4"}`}>
              <button
                type="button"
                onClick={handleToggleExpanded}
                className="text-sm text-slate-500 line-clamp-1 text-left w-full hover:text-slate-300 transition-colors"
              >
                {promptSnippet}...
              </button>
            </div>

            <SessionFeed
              livePanelId={livePanelId}
              showLogs={showLogs}
              activities={task.activities}
            />

            <div id={detailPanelId} className={`expand-grid ${isExpanded ? "expanded" : ""}`}>
              <div className="expand-content">
                <div className="prose prose-sm prose-invert max-w-none mb-8 text-slate-400 prose-headings:text-slate-200 prose-a:text-blue-400 prose-code:text-sky-300 prose-code:bg-slate-800/50 prose-code:px-1 prose-code:rounded prose-strong:text-slate-200">
                  <div dangerouslySetInnerHTML={{ __html: renderedPrompt }} />
                </div>
              </div>
            </div>
          </div>
          <TaskMetadata task={task} />
        </div>
        {task.pr_url && (
          <div className="mt-3 pt-3 border-t border-slate-800">
            <a className="text-[11px] text-sky-400 hover:text-sky-300 font-mono" href={task.pr_url} target="_blank" rel="noreferrer">
              PR: {task.pr_url}
            </a>
          </div>
        )}
      </div>
    );
  },
  (prevProps, nextProps) => {
    return (
      prevProps.onRerunTask === nextProps.onRerunTask &&
      prevProps.task.id === nextProps.task.id &&
      prevProps.task.status === nextProps.task.status &&
      prevProps.task.title === nextProps.task.title &&
      prevProps.task.prompt === nextProps.task.prompt &&
      prevProps.task.session_id === nextProps.task.session_id &&
      prevProps.task.session_name === nextProps.task.session_name &&
      prevProps.task.provider === nextProps.task.provider &&
      prevProps.task.merge_indicator === nextProps.task.merge_indicator &&
      prevProps.task.pr_url === nextProps.task.pr_url &&
      prevProps.task.activities === nextProps.task.activities
    );
  }
);
