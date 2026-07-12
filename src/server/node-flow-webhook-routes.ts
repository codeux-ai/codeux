import type { Express } from "express";
import type { DashboardDependencies } from "./dashboard-server.js";
import { asyncRoute } from "./route-utils.js";
import { HttpRouteError } from "./http-errors.js";
import { requireTrimmedString } from "./request-parsers.js";
import type { NodeFlowJsonObject } from "../contracts/node-flow-types.js";

export function registerNodeFlowWebhookRoutes(app: Express, deps: DashboardDependencies): void {
  if (!deps.automationWebhookTriggerRepository || !deps.nodeFlowService) return;
  app.post("/api/webhooks/node-flows/:pathToken", asyncRoute(async (req, res) => {
    const secretHeader = req.headers["x-codeux-webhook-secret"];
    const secret = Array.isArray(secretHeader) ? secretHeader[0] : secretHeader;
    if (typeof secret !== "string" || !secret.trim()) throw new HttpRouteError(401, "Webhook authentication failed.");
    const trigger = deps.automationWebhookTriggerRepository!.authenticate(
      requireTrimmedString(req.params.pathToken, "pathToken"),
      secret.trim(),
    );
    if (!trigger) throw new HttpRouteError(401, "Webhook authentication failed.");
    const payload = req.body && typeof req.body === "object" && !Array.isArray(req.body)
      ? req.body as NodeFlowJsonObject : {};
    const result = await deps.nodeFlowService!.runFlow(trigger.projectId, trigger.flowId, payload, {
      triggerType: "webhook", triggerPayload: payload, versionSelection: { mode: "latest_published" },
    });
    res.status(202).json({ runId: result.run.id, status: result.run.status });
  }));
}
