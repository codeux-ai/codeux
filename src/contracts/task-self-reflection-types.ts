export interface TaskSelfReflectionSectionRating {
  label: string;
  normalizedLabel: string;
  rating: number;
  note: string | null;
}

export interface TaskSelfReflectionRating {
  id: string;
  projectId: string;
  sprintId: string;
  taskId: string;
  sourceTaskRunId: string;
  overallRating: number;
  sections: TaskSelfReflectionSectionRating[];
  capturedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertTaskSelfReflectionRatingInput {
  projectId: string;
  sprintId: string;
  taskId: string;
  sourceTaskRunId: string;
  overallRating: number;
  sections: TaskSelfReflectionSectionRating[];
  capturedAt?: string;
}
