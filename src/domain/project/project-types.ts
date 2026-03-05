import { ProjectId, ProjectStatus } from "../../contracts/app-types.js";

export interface ProjectState {
  id: ProjectId;
  source_id: string;
  normalized_base_dir: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  created_at: string;
  updated_at: string;
}

export interface CreateProjectCommand {
  source_id: string;
  normalized_base_dir: string;
  name: string;
  description?: string;
}

export interface UpdateProjectCommand {
  name?: string;
  description?: string;
}
