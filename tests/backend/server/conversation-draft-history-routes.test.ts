import express, { type Express } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import type {
  ConversationDraftRecord,
  ConversationMessageHistoryRecord,
  RecordConversationMessageHistoryInput,
  UpsertConversationDraftInput,
} from "../../../src/contracts/connection-chat-types.js";
import { registerConversationRoutes } from "../../../src/server/conversation-routes.js";
import type { DashboardDependencies } from "../../../src/server/dashboard-server.js";

const createApp = (...registrars: Array<(app: Express) => void>): Express => {
  const app = express();
  app.use(express.json());
  for (const register of registrars) {
    register(app);
  }
  return app;
};

const timestamp = "2026-03-10T12:00:00.000Z";

describe("conversation draft and history routes", () => {
  it("keeps draft and recent message state isolated by dashboard user and project", async () => {
    const drafts = new Map<string, ConversationDraftRecord>();
    const history = new Map<string, ConversationMessageHistoryRecord[]>();

    const draftKey = (projectId: string, userId: string, contextKey: string): string => (
      `${projectId}:${userId}:${contextKey}`
    );
    const historyKey = (projectId: string, userId: string): string => `${projectId}:${userId}`;

    const deps = {
      listConversationThreads: () => [],
      createConversationThread: () => ({ id: "thread-1" }),
      updateConversationThread: () => ({ id: "thread-1" }),
      deleteConversationThread: () => undefined,
      listConversationMessages: () => [],
      postConversationMessage: () => ({ id: "message-1" }),
      getConversationDraft: (projectId: string, input: { userId: string; contextKey: string }) => (
        drafts.get(draftKey(projectId, input.userId, input.contextKey)) ?? null
      ),
      upsertConversationDraft: (projectId: string, input: UpsertConversationDraftInput) => {
        const key = draftKey(projectId, input.userId, input.contextKey);
        if (!input.bodyMarkdown.trim()) {
          drafts.delete(key);
          return null;
        }
        const record: ConversationDraftRecord = {
          userId: input.userId,
          projectId,
          contextKey: input.contextKey,
          bodyMarkdown: input.bodyMarkdown,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        drafts.set(key, record);
        return record;
      },
      listConversationMessageHistory: (projectId: string, input: { userId: string }) => (
        history.get(historyKey(projectId, input.userId)) ?? []
      ),
      recordConversationMessageHistory: (projectId: string, input: RecordConversationMessageHistoryInput) => {
        const key = historyKey(projectId, input.userId);
        const record: ConversationMessageHistoryRecord = {
          id: `history-${projectId}-${input.userId}-${history.get(key)?.length ?? 0}`,
          userId: input.userId,
          projectId,
          bodyMarkdown: input.bodyMarkdown,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        history.set(key, [...(history.get(key) ?? []), record]);
        return record;
      },
    } as unknown as DashboardDependencies;

    const app = createApp((router) => registerConversationRoutes(router, deps));

    await request(app)
      .put("/api/projects/project-1/conversations/draft")
      .set("X-CodeUX-Dashboard-User-Id", "user-a")
      .send({ contextKey: "new-thread", bodyMarkdown: "Draft from user A" })
      .expect(200);
    await request(app)
      .put("/api/projects/project-1/conversations/draft")
      .set("X-CodeUX-Dashboard-User-Id", "user-b")
      .send({ contextKey: "new-thread", bodyMarkdown: "Draft from user B" })
      .expect(200);
    await request(app)
      .put("/api/projects/project-2/conversations/draft")
      .set("X-CodeUX-Dashboard-User-Id", "user-a")
      .send({ contextKey: "new-thread", bodyMarkdown: "Draft from project 2" })
      .expect(200);

    await expect(request(app)
      .get("/api/projects/project-1/conversations/draft?contextKey=new-thread")
      .set("X-CodeUX-Dashboard-User-Id", "user-a"))
      .resolves.toMatchObject({ status: 200, body: { bodyMarkdown: "Draft from user A" } });
    await expect(request(app)
      .get("/api/projects/project-1/conversations/draft?contextKey=new-thread")
      .set("X-CodeUX-Dashboard-User-Id", "user-b"))
      .resolves.toMatchObject({ status: 200, body: { bodyMarkdown: "Draft from user B" } });
    await expect(request(app)
      .get("/api/projects/project-2/conversations/draft?contextKey=new-thread")
      .set("X-CodeUX-Dashboard-User-Id", "user-a"))
      .resolves.toMatchObject({ status: 200, body: { bodyMarkdown: "Draft from project 2" } });

    await request(app)
      .post("/api/projects/project-1/conversations/message-history")
      .set("X-CodeUX-Dashboard-User-Id", "user-a")
      .send({ bodyMarkdown: "User A history" })
      .expect(201);
    await request(app)
      .post("/api/projects/project-1/conversations/message-history")
      .set("X-CodeUX-Dashboard-User-Id", "user-b")
      .send({ bodyMarkdown: "User B history" })
      .expect(201);
    await request(app)
      .post("/api/projects/project-2/conversations/message-history")
      .set("X-CodeUX-Dashboard-User-Id", "user-a")
      .send({ bodyMarkdown: "Project 2 history" })
      .expect(201);

    const userAProjectOne = await request(app)
      .get("/api/projects/project-1/conversations/message-history")
      .set("X-CodeUX-Dashboard-User-Id", "user-a")
      .expect(200);
    expect(userAProjectOne.body.map((entry: ConversationMessageHistoryRecord) => entry.bodyMarkdown))
      .toEqual(["User A history"]);

    const userBProjectOne = await request(app)
      .get("/api/projects/project-1/conversations/message-history")
      .set("X-CodeUX-Dashboard-User-Id", "user-b")
      .expect(200);
    expect(userBProjectOne.body.map((entry: ConversationMessageHistoryRecord) => entry.bodyMarkdown))
      .toEqual(["User B history"]);

    const userAProjectTwo = await request(app)
      .get("/api/projects/project-2/conversations/message-history")
      .set("X-CodeUX-Dashboard-User-Id", "user-a")
      .expect(200);
    expect(userAProjectTwo.body.map((entry: ConversationMessageHistoryRecord) => entry.bodyMarkdown))
      .toEqual(["Project 2 history"]);
  });
});
