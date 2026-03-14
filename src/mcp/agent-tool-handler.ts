import type { WorkerDispatchExecutionService } from "../services/worker-dispatch-execution-service.js";
import type { WorkerInboxReplyService } from "../services/worker-inbox-reply-service.js";

interface AgentToolHandlerDependencies {
  workerDispatchExecutionService: WorkerDispatchExecutionService;
  workerInboxReplyService: WorkerInboxReplyService;
}

export class AgentToolHandler {
  constructor(private readonly deps: AgentToolHandlerDependencies) {}

  async handleExecuteWorkerDispatch(args: { dispatch_id: string }) {
    const result = await this.deps.workerDispatchExecutionService.executeDispatch(args.dispatch_id);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }

  async handleCancelLocalDispatch(args: { dispatch_id: string; reason?: string }) {
    const result = await this.deps.workerDispatchExecutionService.cancelLocalDispatch(args.dispatch_id, args.reason);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }

  async handleGenerateDashboardReply(args: {
    project_id: string;
    thread_id: string;
    thread_title?: string;
    body_markdown: string;
  }) {
    const result = await this.deps.workerInboxReplyService.generateReply({
      projectId: args.project_id,
      threadId: args.thread_id,
      threadTitle: args.thread_title,
      bodyMarkdown: args.body_markdown,
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
}
