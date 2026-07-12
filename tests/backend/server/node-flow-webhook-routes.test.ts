import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { registerNodeFlowWebhookRoutes } from "../../../src/server/node-flow-webhook-routes.js";

describe("node flow webhook ingress", () => {
  it("rejects unauthenticated requests and dispatches authenticated payloads", async () => {
    const authenticate = vi.fn((pathToken: string, secret: string) => pathToken === "path" && secret === "secret"
      ? { projectId: "project-1", flowId: "flow-1" } : null);
    const runFlow = vi.fn().mockResolvedValue({ run: { id: "run-1", status: "succeeded" } });
    const app = express(); app.use(express.json());
    registerNodeFlowWebhookRoutes(app, { automationWebhookTriggerRepository: { authenticate }, nodeFlowService: { runFlow } } as never);

    expect((await request(app).post("/api/webhooks/node-flows/path").send({ ok: true })).status).toBe(401);
    const accepted = await request(app).post("/api/webhooks/node-flows/path")
      .set("x-codeux-webhook-secret", "secret").send({ ok: true });
    expect(accepted.status).toBe(202);
    expect(runFlow).toHaveBeenCalledWith("project-1", "flow-1", { ok: true }, expect.objectContaining({ triggerType: "webhook" }));
  });
});
