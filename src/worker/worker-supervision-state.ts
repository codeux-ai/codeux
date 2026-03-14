import type {
  ListenAssignmentChangedEvent,
  ListenAttentionItemEvent,
  ListenContextDigestPayload,
  ListenProjectPayload,
} from "../contracts/connection-chat-types.js";

interface WorkerSupervisionProjectEntry {
  project: ListenProjectPayload;
  workingDirectoryHint: string;
  contextDigest: ListenContextDigestPayload | null;
  assignmentRole: string | null;
  assignmentStatus: string | null;
  activeAttentionItemIds: Set<string>;
  updatedAt: string | null;
}

export interface WorkerSupervisionProjectSnapshot {
  projectId: string;
  projectName: string;
  repoPath: string;
  defaultBranch: string | null;
  featureBranch: string | null;
  workingDirectoryHint: string;
  assignmentRole: string | null;
  assignmentStatus: string | null;
  activeAttentionItemIds: string[];
  contextDigest: ListenContextDigestPayload | null;
  updatedAt: string | null;
}

export class WorkerSupervisionState {
  private readonly projects = new Map<string, WorkerSupervisionProjectEntry>();

  constructor(private readonly initialActiveProjectIds: string[] = []) {}

  noteAssignmentChanged(event: ListenAssignmentChangedEvent): void {
    const entry = this.getOrCreateProjectEntry(event.project, event.workingDirectoryHint);
    entry.project = event.project;
    entry.workingDirectoryHint = event.workingDirectoryHint;
    entry.contextDigest = event.contextDigest;
    entry.assignmentRole = event.assignment.assignmentRole;
    entry.assignmentStatus = event.assignment.status;
    entry.updatedAt = event.assignment.updatedAt;

    this.pruneProjectIfInactive(event.project.id);
  }

  noteAttentionItem(event: ListenAttentionItemEvent): void {
    const entry = this.getOrCreateProjectEntry(event.project, event.workingDirectoryHint);
    entry.project = event.project;
    entry.workingDirectoryHint = event.workingDirectoryHint;
    entry.contextDigest = event.contextDigest;
    entry.updatedAt = event.item.updatedAt;

    if (event.item.status === "resolved" || event.item.status === "dismissed" || event.item.status === "expired") {
      entry.activeAttentionItemIds.delete(event.item.id);
    } else {
      entry.activeAttentionItemIds.add(event.item.id);
    }

    this.pruneProjectIfInactive(event.project.id);
  }

  markAttentionItemClaimed(projectId: string, attentionItemId: string): void {
    const entry = this.projects.get(projectId);
    if (!entry) {
      return;
    }
    entry.activeAttentionItemIds.add(attentionItemId);
  }

  markAttentionItemResolved(projectId: string, attentionItemId: string): void {
    const entry = this.projects.get(projectId);
    if (!entry) {
      return;
    }
    entry.activeAttentionItemIds.delete(attentionItemId);
    this.pruneProjectIfInactive(projectId);
  }

  getActiveProjectIds(): string[] {
    const activeProjectIds = Array.from(this.projects.entries())
      .filter(([, entry]) => this.isProjectActive(entry))
      .map(([projectId]) => projectId);

    return activeProjectIds.length > 0
      ? activeProjectIds
      : this.initialActiveProjectIds.filter((value) => value.trim().length > 0);
  }

  listProjectSnapshots(): WorkerSupervisionProjectSnapshot[] {
    return Array.from(this.projects.entries()).map(([projectId, entry]) => ({
      projectId,
      projectName: entry.project.name,
      repoPath: entry.project.repoPath,
      defaultBranch: entry.project.defaultBranch,
      featureBranch: entry.project.featureBranch,
      workingDirectoryHint: entry.workingDirectoryHint,
      assignmentRole: entry.assignmentRole,
      assignmentStatus: entry.assignmentStatus,
      activeAttentionItemIds: Array.from(entry.activeAttentionItemIds),
      contextDigest: entry.contextDigest,
      updatedAt: entry.updatedAt,
    }));
  }

  private getOrCreateProjectEntry(
    project: ListenProjectPayload,
    workingDirectoryHint: string,
  ): WorkerSupervisionProjectEntry {
    const existing = this.projects.get(project.id);
    if (existing) {
      return existing;
    }

    const created: WorkerSupervisionProjectEntry = {
      project,
      workingDirectoryHint,
      contextDigest: null,
      assignmentRole: null,
      assignmentStatus: null,
      activeAttentionItemIds: new Set<string>(),
      updatedAt: null,
    };
    this.projects.set(project.id, created);
    return created;
  }

  private isProjectActive(entry: WorkerSupervisionProjectEntry): boolean {
    return entry.assignmentStatus === "active" || entry.activeAttentionItemIds.size > 0;
  }

  private pruneProjectIfInactive(projectId: string): void {
    const entry = this.projects.get(projectId);
    if (!entry) {
      return;
    }
    if (this.isProjectActive(entry)) {
      return;
    }
    if (this.initialActiveProjectIds.includes(projectId)) {
      return;
    }
    this.projects.delete(projectId);
  }
}
