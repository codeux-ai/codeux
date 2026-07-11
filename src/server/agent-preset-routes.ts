import type { Express } from "express";
import type { DashboardDependencies } from "./dashboard-server.js";
import { asyncRoute } from "./route-utils.js";
import { requireTrimmedString } from "./request-parsers.js";
import { HttpRouteError } from "./http-errors.js";
import type { CreateAgentPresetInput, PushAgentPresetsToMarkdownOptions, UpdateAgentPresetInput } from "../contracts/agent-preset-types.js";
import type {
  CreateSkillStorageInput,
  SkillRecord,
  SkillStorageContentSummary,
  SkillStorageContentsResponse,
  UpdateSkillStorageInput,
} from "../contracts/skill-types.js";

export const SKILL_STORAGE_CONTENTS_MAX_SKILLS = 100;
export const SKILL_STORAGE_CONTENT_PREVIEW_MAX_LENGTH = 240;

export function registerAgentPresetRoutes(router: Express, deps: DashboardDependencies): void {
  router.get("/api/projects/:projectId/agent-presets", asyncRoute(async (req, res) => {
    res.json(await deps.listAgentPresets(requireTrimmedString(req.params.projectId, "projectId")));
  }));

  router.post("/api/projects/:projectId/agent-presets", asyncRoute(async (req, res) => {
    res.status(201).json(await deps.createAgentPreset(requireTrimmedString(req.params.projectId, "projectId"), req.body as CreateAgentPresetInput));
  }));

  router.patch("/api/agent-presets/:agentPresetId", asyncRoute(async (req, res) => {
    res.json(await deps.updateAgentPreset(requireTrimmedString(req.params.agentPresetId, "agentPresetId"), req.body as UpdateAgentPresetInput));
  }));

  router.delete("/api/agent-presets/:agentPresetId", asyncRoute(async (req, res) => {
    await deps.deleteAgentPreset(requireTrimmedString(req.params.agentPresetId, "agentPresetId"));
    res.json({ ok: true });
  }));

  router.post("/api/agent-presets/:agentPresetId/import-markdown", asyncRoute(async (req, res) => {
    if (!deps.importAgentPresetFromMarkdown) {
      res.status(404).json({ error: "Markdown import is not enabled for agents." });
      return;
    }
    res.json(await deps.importAgentPresetFromMarkdown(requireTrimmedString(req.params.agentPresetId, "agentPresetId")));
  }));

  router.post("/api/agent-presets/:agentPresetId/export-markdown", asyncRoute(async (req, res) => {
    if (!deps.exportAgentPresetToMarkdown) {
      res.status(404).json({ error: "Markdown export is not enabled for agents." });
      return;
    }
    res.json(await deps.exportAgentPresetToMarkdown(requireTrimmedString(req.params.agentPresetId, "agentPresetId")));
  }));

  router.post("/api/projects/:projectId/agent-presets/sync-markdown", asyncRoute(async (req, res) => {
    if (!deps.syncAllAgentPresetsFromMarkdown) {
      res.status(404).json({ error: "Bulk markdown sync is not enabled for agents." });
      return;
    }
    res.json(await deps.syncAllAgentPresetsFromMarkdown(requireTrimmedString(req.params.projectId, "projectId")));
  }));

  router.post("/api/projects/:projectId/agent-presets/pull-markdown", asyncRoute(async (req, res) => {
    if (!deps.pullAgentPresetsFromMarkdown) {
      res.status(404).json({ error: "Bulk markdown pull is not enabled for agents." });
      return;
    }
    res.json(await deps.pullAgentPresetsFromMarkdown(requireTrimmedString(req.params.projectId, "projectId")));
  }));

  router.post("/api/projects/:projectId/agent-presets/push-markdown", asyncRoute(async (req, res) => {
    if (!deps.pushAgentPresetsToMarkdown) {
      res.status(404).json({ error: "Bulk markdown push is not enabled for agents." });
      return;
    }
    const body = req.body as PushAgentPresetsToMarkdownOptions | undefined;
    res.json(await deps.pushAgentPresetsToMarkdown(
      requireTrimmedString(req.params.projectId, "projectId"),
      body,
    ));
  }));

  router.post("/api/projects/:projectId/agent-presets/push", asyncRoute(async (req, res) => {
    if (!deps.pushAgentPresetsToRepository) {
      res.status(404).json({ error: "Agent preset push is not enabled for agents." });
      return;
    }
    const projectId = requireTrimmedString(req.params.projectId, "projectId");
    const body = req.body as {
      mode?: "commit_only" | "commit_and_push" | "pull_request";
      branchName?: string;
    };
    res.json(await deps.pushAgentPresetsToRepository(projectId, {
      mode: body.mode ?? "commit_only",
      branchName: body.branchName,
    }));
  }));

  router.get("/api/projects/:projectId/skill-storages", asyncRoute(async (req, res) => {
    const skillService = requireSkillService(deps);
    res.json(skillService.listStorages(requireTrimmedString(req.params.projectId, "projectId")));
  }));

  router.post("/api/projects/:projectId/skill-storages", asyncRoute(async (req, res) => {
    const skillService = requireSkillService(deps);
    const projectId = requireTrimmedString(req.params.projectId, "projectId");
    const body = req.body as CreateSkillStorageInput;
    res.status(201).json(skillService.createStorage(projectId, body));
  }));

  router.patch("/api/projects/:projectId/skill-storages/:storageId", asyncRoute(async (req, res) => {
    const skillService = requireSkillService(deps);
    const projectId = requireTrimmedString(req.params.projectId, "projectId");
    const storageId = requireTrimmedString(req.params.storageId, "storageId");
    res.json(skillService.updateStorage(projectId, storageId, req.body as UpdateSkillStorageInput));
  }));

  router.get("/api/projects/:projectId/skill-storages/:storageId/contents", asyncRoute(async (req, res) => {
    const skillService = requireSkillService(deps);
    const projectId = requireTrimmedString(req.params.projectId, "projectId");
    const storageId = requireTrimmedString(req.params.storageId, "storageId");
    const storage = skillService.getStorage(projectId, storageId);
    if (!storage) {
      throw new HttpRouteError(404, `Skill storage not found: ${storageId}`);
    }

    const records = skillService.listByStorage(projectId, storageId, SKILL_STORAGE_CONTENTS_MAX_SKILLS + 1);
    const response: SkillStorageContentsResponse = {
      storage,
      skills: records.slice(0, SKILL_STORAGE_CONTENTS_MAX_SKILLS).map(toSkillStorageContentSummary),
      truncated: records.length > SKILL_STORAGE_CONTENTS_MAX_SKILLS,
    };
    res.json(response);
  }));

  router.delete("/api/projects/:projectId/skill-storages/:storageId", asyncRoute(async (req, res) => {
    const skillService = requireSkillService(deps);
    skillService.deleteStorage(
      requireTrimmedString(req.params.projectId, "projectId"),
      requireTrimmedString(req.params.storageId, "storageId"),
    );
    res.json({ ok: true });
  }));
}

function toSkillStorageContentSummary(skill: SkillRecord): SkillStorageContentSummary {
  const normalizedContent = skill.contentMarkdown.replace(/\s+/g, " ").trim();
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    tags: skill.tags,
    appliesTo: skill.appliesTo,
    version: skill.version,
    updatedAt: skill.updatedAt,
    contentPreview: normalizedContent.length <= SKILL_STORAGE_CONTENT_PREVIEW_MAX_LENGTH
      ? normalizedContent
      : `${normalizedContent.slice(0, SKILL_STORAGE_CONTENT_PREVIEW_MAX_LENGTH - 3).trimEnd()}...`,
  };
}

function requireSkillService(deps: DashboardDependencies): NonNullable<DashboardDependencies["skillService"]> {
  if (!deps.skillService) {
    throw new Error("Persistent skill storage is unavailable.");
  }
  return deps.skillService;
}
