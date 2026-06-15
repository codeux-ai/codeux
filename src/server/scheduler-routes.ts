import type { Express } from "express";
import type { DashboardDependencies } from "./dashboard-server.js";
import { asyncRoute, syncRoute } from "./route-utils.js";
import { requireTrimmedString } from "./request-parsers.js";
import type { CreateSchedulerEntryInput, UpdateSchedulerEntryInput } from "../contracts/scheduler-types.js";

function defaultScheduleWindow(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 7));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 35, 23, 59, 59, 999));
  return { from: from.toISOString(), to: to.toISOString() };
}

function parseDateQuery(value: unknown, fallback: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return fallback;
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    return fallback;
  }
  return parsed.toISOString();
}

export function registerSchedulerRoutes(app: Express, deps: DashboardDependencies): void {
  app.get("/api/projects/:projectId/scheduler", syncRoute((req, res) => {
    if (!deps.schedulerService) {
      res.status(404).json({ error: "Scheduler service is not enabled." });
      return;
    }
    const defaults = defaultScheduleWindow();
    const from = parseDateQuery(req.query.from, defaults.from);
    const to = parseDateQuery(req.query.to, defaults.to);
    res.json(deps.schedulerService.listProjectSchedule(
      requireTrimmedString(req.params.projectId, "projectId"),
      from,
      to,
    ));
  }));

  app.post("/api/projects/:projectId/scheduler", syncRoute((req, res) => {
    if (!deps.schedulerService) {
      res.status(404).json({ error: "Scheduler service is not enabled." });
      return;
    }
    const entry = deps.schedulerService.createEntry(
      requireTrimmedString(req.params.projectId, "projectId"),
      req.body as CreateSchedulerEntryInput,
    );
    res.status(201).json(entry);
  }));

  app.patch("/api/scheduler/:entryId", syncRoute((req, res) => {
    if (!deps.schedulerService) {
      res.status(404).json({ error: "Scheduler service is not enabled." });
      return;
    }
    res.json(deps.schedulerService.updateEntry(
      requireTrimmedString(req.params.entryId, "entryId"),
      req.body as UpdateSchedulerEntryInput,
    ));
  }));

  app.delete("/api/scheduler/:entryId", syncRoute((req, res) => {
    if (!deps.schedulerService) {
      res.status(404).json({ error: "Scheduler service is not enabled." });
      return;
    }
    deps.schedulerService.deleteEntry(requireTrimmedString(req.params.entryId, "entryId"));
    res.json({ ok: true });
  }));

  app.post("/api/scheduler/run-due", asyncRoute(async (_req, res) => {
    if (!deps.schedulerService) {
      res.status(404).json({ error: "Scheduler service is not enabled." });
      return;
    }
    await deps.schedulerService.runDueEntries();
    res.json({ ok: true });
  }));
}
