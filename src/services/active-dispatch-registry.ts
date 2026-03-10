export interface ActiveDispatchStopResult {
  accepted: boolean;
  message?: string;
}

export interface ActiveDispatchHandle {
  dispatchId: string;
  taskRunId?: string;
  sessionId?: string;
  executorType: "docker_cli" | "jules" | "mcp_worker";
  requestStop: (reason: string) => Promise<ActiveDispatchStopResult> | ActiveDispatchStopResult;
}

export class ActiveDispatchRegistry {
  private readonly handles = new Map<string, ActiveDispatchHandle>();

  register(handle: ActiveDispatchHandle): () => void {
    this.handles.set(handle.dispatchId, handle);
    return () => {
      const current = this.handles.get(handle.dispatchId);
      if (current === handle) {
        this.handles.delete(handle.dispatchId);
      }
    };
  }

  get(dispatchId: string): ActiveDispatchHandle | null {
    return this.handles.get(dispatchId) || null;
  }

  async requestStop(dispatchId: string, reason: string): Promise<ActiveDispatchStopResult> {
    const handle = this.get(dispatchId);
    if (!handle) {
      return {
        accepted: false,
        message: "Active executor handle is not registered on this Sprint OS server.",
      };
    }
    return await handle.requestStop(reason);
  }
}
