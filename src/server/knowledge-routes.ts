import type { Express, Response } from "express";
import multer from "multer";
import * as fs from "fs/promises";
import * as path from "path";
import type { KnowledgeService } from "../services/knowledge-service.js";
import type { AgentPresetRepository } from "../repositories/agent-preset-repository.js";
import type { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import type { KnowledgeDocumentSummary } from "../contracts/knowledge-types.js";
import { asyncRoute, syncRoute, toErrorResponse } from "./route-utils.js";
import { requireTrimmedString } from "./request-parsers.js";

const MODEL_REQUIRED_MESSAGE =
  "No embedding model is loaded. Download and select one under Settings → Memory before adding documents.";

const IGNORED_DIRECTORIES = new Set([
  "node_modules", ".git", "dist", "build", ".next", ".cache", "coverage",
  ".turbo", ".vercel", ".output", "out", ".svelte-kit", "vendor", ".venv", "__pycache__",
]);

const MAX_DIRECTORY_FILES = 100;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 25 },
});

export interface KnowledgeRouteDependencies {
  knowledgeService: KnowledgeService;
  agentPresetRepository: AgentPresetRepository;
  projectManagementRepository: ProjectManagementRepository;
}

export function registerKnowledgeRoutes(app: Express, deps: KnowledgeRouteDependencies): void {
  const { knowledgeService, agentPresetRepository, projectManagementRepository } = deps;

  const requireModel = (res: Response): boolean => {
    if (!knowledgeService.isModelLoaded()) {
      res.status(409).json({ error: MODEL_REQUIRED_MESSAGE });
      return false;
    }
    return true;
  };

  // --- Library ---

  app.get("/api/projects/:projectId/knowledge/documents", syncRoute((req, res) => {
    try {
      const projectId = requireTrimmedString(req.params.projectId, "projectId");
      res.json(knowledgeService.listDocuments(projectId));
    } catch (error) {
      res.status(400).json(toErrorResponse(error, "Failed to list knowledge documents"));
    }
  }));

  app.get("/api/knowledge/documents/:documentId", syncRoute((req, res) => {
    try {
      const documentId = requireTrimmedString(req.params.documentId, "documentId");
      const doc = knowledgeService.getDocument(documentId);
      if (!doc) {
        res.status(404).json({ error: "Document not found" });
        return;
      }
      res.json(doc);
    } catch (error) {
      res.status(400).json(toErrorResponse(error, "Failed to get knowledge document"));
    }
  }));

  // Create from pasted text or an in-repo path (file or directory).
  app.post("/api/projects/:projectId/knowledge/documents", asyncRoute(async (req, res) => {
    try {
      const projectId = requireTrimmedString(req.params.projectId, "projectId");
      if (!requireModel(res)) return;

      const body = (req.body ?? {}) as { title?: string; text?: string; path?: string };

      if (typeof body.path === "string" && body.path.trim()) {
        const project = projectManagementRepository.getProject(projectId);
        if (!project) {
          res.status(404).json({ error: "Project not found" });
          return;
        }
        const result = await ingestRepoPath(knowledgeService, project.baseDir, projectId, body.path.trim());
        res.status(result.documents.length ? 201 : 400).json(result);
        return;
      }

      const text = typeof body.text === "string" ? body.text : "";
      if (!text.trim()) {
        res.status(400).json({ error: "Provide `text` for a pasted note or `path` for an in-repo file/directory." });
        return;
      }
      const doc = await knowledgeService.ingestDocument(projectId, {
        title: body.title?.trim() || "Pasted note",
        sourceType: "paste",
        text,
      });
      res.status(201).json(doc);
    } catch (error) {
      res.status(400).json(toErrorResponse(error, "Failed to add knowledge document"));
    }
  }));

  // Upload one or more files (multipart). Supports text/code/JSON/CSV/HTML plus PDF and DOCX.
  app.post(
    "/api/projects/:projectId/knowledge/documents/upload",
    upload.array("files", 25),
    asyncRoute(async (req, res) => {
      try {
        const projectId = requireTrimmedString(req.params.projectId, "projectId");
        if (!requireModel(res)) return;

        const files = (req.files as Express.Multer.File[] | undefined) ?? [];
        if (files.length === 0) {
          res.status(400).json({ error: "No files were uploaded." });
          return;
        }

        const documents: KnowledgeDocumentSummary[] = [];
        const errors: Array<{ fileName: string; error: string }> = [];
        for (const file of files) {
          try {
            const doc = await knowledgeService.ingestDocument(projectId, {
              title: file.originalname,
              sourceType: "upload",
              sourceRef: file.originalname,
              mimeType: file.mimetype,
              buffer: file.buffer,
            });
            documents.push(doc);
          } catch (error) {
            errors.push({ fileName: file.originalname, error: error instanceof Error ? error.message : String(error) });
          }
        }
        res.status(documents.length ? 201 : 400).json({ documents, errors });
      } catch (error) {
        res.status(400).json(toErrorResponse(error, "Failed to upload knowledge documents"));
      }
    }),
  );

  app.post("/api/projects/:projectId/knowledge/documents/import-project", asyncRoute(async (req, res) => {
    try {
      const projectId = requireTrimmedString(req.params.projectId, "projectId");
      if (!requireModel(res)) return;

      const body = (req.body ?? {}) as { sourceProjectId?: unknown; documentIds?: unknown };
      const sourceProjectId = typeof body.sourceProjectId === "string" ? body.sourceProjectId.trim() : "";
      if (!sourceProjectId) {
        res.status(400).json({ error: "sourceProjectId is required" });
        return;
      }
      if (!projectManagementRepository.getProject(sourceProjectId)) {
        res.status(404).json({ error: "Source project not found" });
        return;
      }
      const documentIds = Array.isArray(body.documentIds)
        ? body.documentIds.filter((id): id is string => typeof id === "string")
        : undefined;
      const result = await knowledgeService.importDocumentsFromProject(projectId, sourceProjectId, documentIds);
      res.status(result.documents.length ? 201 : 400).json(result);
    } catch (error) {
      res.status(400).json(toErrorResponse(error, "Failed to import project knowledge"));
    }
  }));

  app.delete("/api/knowledge/documents/:documentId", syncRoute((req, res) => {
    try {
      knowledgeService.deleteDocument(requireTrimmedString(req.params.documentId, "documentId"));
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json(toErrorResponse(error, "Failed to delete knowledge document"));
    }
  }));

  app.post("/api/knowledge/documents/:documentId/reembed", asyncRoute(async (req, res) => {
    try {
      const documentId = requireTrimmedString(req.params.documentId, "documentId");
      if (!requireModel(res)) return;
      await knowledgeService.reembedDocument(documentId);
      res.json(knowledgeService.getDocument(documentId));
    } catch (error) {
      res.status(400).json(toErrorResponse(error, "Failed to re-embed knowledge document"));
    }
  }));

  app.post("/api/projects/:projectId/knowledge/search", asyncRoute(async (req, res) => {
    try {
      const projectId = requireTrimmedString(req.params.projectId, "projectId");
      const body = (req.body ?? {}) as { query?: string; documentIds?: string[]; agentPresetId?: string; limit?: number };
      const query = typeof body.query === "string" ? body.query : "";
      if (!query.trim()) {
        res.status(400).json({ error: "query is required" });
        return;
      }

      let documentIds: string[];
      if (Array.isArray(body.documentIds)) {
        documentIds = body.documentIds.filter((id): id is string => typeof id === "string");
      } else if (typeof body.agentPresetId === "string" && body.agentPresetId) {
        documentIds = knowledgeService.listSubscriptions(body.agentPresetId);
      } else {
        documentIds = knowledgeService.listDocuments(projectId).map((doc) => doc.id);
      }

      const limit = typeof body.limit === "number" && body.limit > 0 ? Math.min(Math.floor(body.limit), 20) : 8;
      res.json(await knowledgeService.search(documentIds, query, limit));
    } catch (error) {
      res.status(400).json(toErrorResponse(error, "Failed to search knowledge"));
    }
  }));

  // --- Per-agent subscriptions ---

  app.get("/api/agent-presets/:agentPresetId/knowledge", syncRoute((req, res) => {
    try {
      const agentPresetId = requireTrimmedString(req.params.agentPresetId, "agentPresetId");
      res.json({ documentIds: knowledgeService.listSubscriptions(agentPresetId) });
    } catch (error) {
      res.status(400).json(toErrorResponse(error, "Failed to list agent knowledge subscriptions"));
    }
  }));

  app.put("/api/agent-presets/:agentPresetId/knowledge/subscriptions", syncRoute((req, res) => {
    try {
      const agentPresetId = requireTrimmedString(req.params.agentPresetId, "agentPresetId");
      const agent = agentPresetRepository.getAgentPreset(agentPresetId);
      if (!agent) {
        res.status(404).json({ error: "Agent not found" });
        return;
      }
      const body = (req.body ?? {}) as { documentIds?: unknown };
      const documentIds = Array.isArray(body.documentIds)
        ? body.documentIds.filter((id): id is string => typeof id === "string")
        : [];
      const updated = knowledgeService.setSubscriptions(agentPresetId, agent.projectId, documentIds);
      res.json({ documentIds: updated });
    } catch (error) {
      res.status(400).json(toErrorResponse(error, "Failed to update agent knowledge subscriptions"));
    }
  }));
}

interface RepoIngestResult {
  documents: KnowledgeDocumentSummary[];
  errors: Array<{ fileName: string; error: string }>;
}

/** Ingest a single in-repo file or all text files under an in-repo directory. */
async function ingestRepoPath(
  knowledgeService: KnowledgeService,
  baseDir: string,
  projectId: string,
  relativePath: string,
): Promise<RepoIngestResult> {
  const resolvedBase = path.resolve(baseDir);
  const target = path.resolve(resolvedBase, relativePath);
  if (target !== resolvedBase && !target.startsWith(resolvedBase + path.sep)) {
    throw new Error("Path must be inside the project directory.");
  }

  const stat = await fs.stat(target).catch(() => null);
  if (!stat) {
    throw new Error(`Path not found: ${relativePath}`);
  }

  const files = stat.isDirectory() ? await collectDirectoryFiles(target) : [target];
  const documents: KnowledgeDocumentSummary[] = [];
  const errors: Array<{ fileName: string; error: string }> = [];

  for (const filePath of files) {
    const rel = path.relative(resolvedBase, filePath);
    try {
      const buffer = await fs.readFile(filePath);
      const doc = await knowledgeService.ingestDocument(projectId, {
        title: rel,
        sourceType: "repo_path",
        sourceRef: rel,
        buffer,
      });
      documents.push(doc);
    } catch (error) {
      errors.push({ fileName: rel, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return { documents, errors };
}

async function collectDirectoryFiles(dir: string): Promise<string[]> {
  const collected: string[] = [];

  const walk = async (current: string): Promise<void> => {
    if (collected.length >= MAX_DIRECTORY_FILES) return;
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (collected.length >= MAX_DIRECTORY_FILES) return;
      if (entry.name.startsWith(".") && entry.isDirectory()) continue;
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) continue;
        await walk(path.join(current, entry.name));
      } else if (entry.isFile()) {
        collected.push(path.join(current, entry.name));
      }
    }
  };

  await walk(dir);
  return collected;
}
