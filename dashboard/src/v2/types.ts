export type SourceStatus = 'running' | 'failed' | 'intervention' | 'idle';

export type SprintStatus = 'running' | 'completed' | 'failed' | 'idle';

export type TaskStatus = 'in_progress' | 'pending' | 'completed';

export type TaskPriority = 'critical' | 'high' | 'medium' | 'low';

export interface Source {
    id: string;
    name: string;
    sprintsCount: number;
    openTasks: number;
    completedTasks: number;
    isRunning: boolean;
    status: SourceStatus;
    updatedAt: string;
}

export interface Task {
    id: string;
    source: string;
    sprint: string;
    sprintId: string;
    title: string;
    status: TaskStatus;
    priority: TaskPriority;
    assignee: string;
    time: string;
    createdAt: string;
}

export interface Sprint {
    id: string;
    name: string;
    date: string;
    tasksCount: number;
    completion: number;
    status: SprintStatus;
}
