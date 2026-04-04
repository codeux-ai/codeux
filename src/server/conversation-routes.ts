import type { Express } from "express";
import type { DashboardDependencies } from "./dashboard-server.js";
import { asyncRoute, requireTrimmedString, syncRoute, parseThreadRouteInput } from "./route-utils.js";
import type {
  CreateConversationThreadInput,
  UpdateConversationThreadInput,
  CreateDashboardConversationMessageInput,
} from "../contracts/connection-chat-types.js";

export function registerConversationRoutes(app: Express, options: DashboardDependencies): void {
  app.get("/api/projects/:projectId/conversations/threads", syncRoute((req, res) => {
    res.json(options.listConversationThreads(requireTrimmedString(req.params.projectId, "projectId")));
  }));

  app.post("/api/projects/:projectId/conversations/threads", syncRoute((req, res) => {
    res.status(201).json(
      options.createConversationThread(requireTrimmedString(req.params.projectId, "projectId"), req.body as CreateConversationThreadInput)
    );
  }));

  app.patch("/api/conversations/threads/:threadId", syncRoute((req, res) => {
    res.json(options.updateConversationThread(requireTrimmedString(req.params.threadId, "threadId"), req.body as UpdateConversationThreadInput));
  }));

  app.put("/api/conversations/threads/:threadId/route", syncRoute((req, res) => {
    if (!options.updateThreadRoute) {
      res.status(404).json({ error: "Thread routing is not enabled." });
      return;
    }
    const input = parseThreadRouteInput(req.body);
    res.json(options.updateThreadRoute(requireTrimmedString(req.params.threadId, "threadId"), input));
  }));

  app.post("/api/conversations/threads/:threadId/compact", asyncRoute(async (req, res) => {
    if (!options.compactThreadSession) {
      res.status(404).json({ error: "Thread compaction is not enabled." });
      return;
    }
    res.json(await options.compactThreadSession(requireTrimmedString(req.params.threadId, "threadId")));
  }));

  app.delete("/api/conversations/threads/:threadId", syncRoute((req, res) => {
    options.deleteConversationThread(requireTrimmedString(req.params.threadId, "threadId"));
    res.json({ ok: true });
  }));

  app.get("/api/conversations/threads/:threadId/messages", syncRoute((req, res) => {
    res.json(options.listConversationMessages(requireTrimmedString(req.params.threadId, "threadId")));
  }));

  app.post("/api/projects/:projectId/conversations/messages", syncRoute((req, res) => {
    res.status(201).json(
      options.postConversationMessage(requireTrimmedString(req.params.projectId, "projectId"), req.body as CreateDashboardConversationMessageInput)
    );
  }));
}
