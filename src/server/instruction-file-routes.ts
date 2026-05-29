import type { Express } from "express";
import type { DashboardDependencies } from "./dashboard-server.js";
import { asyncRoute, requireTrimmedString } from "./route-utils.js";

export function registerInstructionFileRoutes(router: Express, deps: DashboardDependencies): void {
  router.get("/api/projects/:projectId/instruction-files", asyncRoute(async (req, res) => {
    res.json(await deps.listInstructionFiles(requireTrimmedString(req.params.projectId, "projectId")));
  }));

  router.get("/api/projects/:projectId/instruction-files/:fileId", asyncRoute(async (req, res) => {
    res.json(await deps.readInstructionFile(
      requireTrimmedString(req.params.projectId, "projectId"),
      requireTrimmedString(req.params.fileId, "fileId"),
    ));
  }));

  router.put("/api/projects/:projectId/instruction-files/:fileId", asyncRoute(async (req, res) => {
    const body = (req.body ?? {}) as { content?: unknown };
    if (typeof body.content !== "string") {
      throw new Error("Missing or invalid required field: content");
    }
    res.json(await deps.writeInstructionFile(
      requireTrimmedString(req.params.projectId, "projectId"),
      requireTrimmedString(req.params.fileId, "fileId"),
      body.content,
    ));
  }));
}
