import type { Express } from "express";
import type { DashboardDependencies } from "./dashboard-server.js";
import { asyncRoute, syncRoute } from "./route-utils.js";
import {
  requireTrimmedString,
  parseThreadRouteInput,
  parseCreateConversationThreadInput,
  parseUpdateConversationThreadInput,
  parseCreateDashboardConversationMessageInput,
  parseConversationDraftQuery,
  parseRecordConversationMessageHistoryInput,
  parseUpsertConversationDraftInput,
} from "./request-parsers.js";

const DASHBOARD_USER_HEADER = "x-codeux-dashboard-user-id";

function requireDashboardUserId(value: unknown): string {
  return requireTrimmedString(value, DASHBOARD_USER_HEADER);
}

export function registerConversationRoutes(app: Express, options: DashboardDependencies): void {
  app.get("/api/projects/:projectId/conversations/threads", syncRoute((req, res) => {
    res.json(options.listConversationThreads(requireTrimmedString(req.params.projectId, "projectId")));
  }));

  app.get("/api/projects/:projectId/conversations/draft", syncRoute((req, res) => {
    if (!options.getConversationDraft) {
      res.status(404).json({ error: "Conversation draft storage is not enabled." });
      return;
    }
    const { contextKey } = parseConversationDraftQuery(req.query);
    res.json(options.getConversationDraft(
      requireTrimmedString(req.params.projectId, "projectId"),
      {
        userId: requireDashboardUserId(req.header(DASHBOARD_USER_HEADER)),
        contextKey,
      }
    ) ?? null);
  }));

  app.put("/api/projects/:projectId/conversations/draft", syncRoute((req, res) => {
    if (!options.upsertConversationDraft) {
      res.status(404).json({ error: "Conversation draft storage is not enabled." });
      return;
    }
    res.json(options.upsertConversationDraft(
      requireTrimmedString(req.params.projectId, "projectId"),
      parseUpsertConversationDraftInput(
        req.body,
        requireDashboardUserId(req.header(DASHBOARD_USER_HEADER))
      )
    ) ?? null);
  }));

  app.get("/api/projects/:projectId/conversations/message-history", syncRoute((req, res) => {
    if (!options.listConversationMessageHistory) {
      res.status(404).json({ error: "Conversation message history is not enabled." });
      return;
    }
    res.json(options.listConversationMessageHistory(
      requireTrimmedString(req.params.projectId, "projectId"),
      {
        userId: requireDashboardUserId(req.header(DASHBOARD_USER_HEADER)),
      }
    ));
  }));

  app.post("/api/projects/:projectId/conversations/message-history", syncRoute((req, res) => {
    if (!options.recordConversationMessageHistory) {
      res.status(404).json({ error: "Conversation message history is not enabled." });
      return;
    }
    res.status(201).json(options.recordConversationMessageHistory(
      requireTrimmedString(req.params.projectId, "projectId"),
      parseRecordConversationMessageHistoryInput(
        req.body,
        requireDashboardUserId(req.header(DASHBOARD_USER_HEADER))
      )
    ));
  }));

  app.post("/api/projects/:projectId/conversations/threads", syncRoute((req, res) => {
    res.status(201).json(
      options.createConversationThread(
        requireTrimmedString(req.params.projectId, "projectId"),
        parseCreateConversationThreadInput(req.body)
      )
    );
  }));

  app.patch("/api/conversations/threads/:threadId", asyncRoute(async (req, res) => {
    res.json(await options.updateConversationThread(
      requireTrimmedString(req.params.threadId, "threadId"),
      parseUpdateConversationThreadInput(req.body)
    ));
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

  app.post("/api/conversations/threads/:threadId/cancel", asyncRoute(async (req, res) => {
    if (!options.cancelThreadTurn) {
      res.status(404).json({ error: "Thread cancellation is not enabled." });
      return;
    }
    res.json(await options.cancelThreadTurn(requireTrimmedString(req.params.threadId, "threadId")));
  }));

  app.delete("/api/conversations/threads/:threadId", syncRoute((req, res) => {
    options.deleteConversationThread(requireTrimmedString(req.params.threadId, "threadId"));
    res.json({ ok: true });
  }));

  app.get("/api/conversations/threads/:threadId/messages", syncRoute((req, res) => {
    res.json(options.listConversationMessages(requireTrimmedString(req.params.threadId, "threadId")));
  }));

  app.post("/api/projects/:projectId/conversations/messages", asyncRoute(async (req, res) => {
    res.status(201).json(
      await options.postConversationMessage(
        requireTrimmedString(req.params.projectId, "projectId"),
        parseCreateDashboardConversationMessageInput(req.body)
      )
    );
  }));
}
