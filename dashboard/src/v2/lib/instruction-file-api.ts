import { fetchJson } from "../../lib/api/fetch-json.js";

export interface InstructionFileSummary {
  id: string;
  label: string;
  fileName: string;
  relativePath: string;
  description: string;
  providerId?: string;
  exists: boolean;
  size: number;
  updatedAt: string | null;
}

export interface InstructionFileContent extends InstructionFileSummary {
  content: string;
}

export const fetchInstructionFiles = async (projectId: string): Promise<InstructionFileSummary[]> => {
  return fetchJson<InstructionFileSummary[]>(
    `/api/projects/${encodeURIComponent(projectId)}/instruction-files`,
  );
};

export const fetchInstructionFile = async (
  projectId: string,
  fileId: string,
): Promise<InstructionFileContent> => {
  return fetchJson<InstructionFileContent>(
    `/api/projects/${encodeURIComponent(projectId)}/instruction-files/${encodeURIComponent(fileId)}`,
  );
};

export const saveInstructionFile = async (
  projectId: string,
  fileId: string,
  content: string,
): Promise<InstructionFileContent> => {
  return fetchJson<InstructionFileContent>(
    `/api/projects/${encodeURIComponent(projectId)}/instruction-files/${encodeURIComponent(fileId)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    },
  );
};
