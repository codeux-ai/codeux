import { describe, it, expect } from "vitest";
import {
  getChatWidgetData,
  getInvocationWidgetData,
  getWorkingBubbleData,
} from "../../../dashboard/src/v2/lib/chat-widget-view-models.js";
import type { ChatMessageRecord, ExecutionInvocationMessageRecord, ConversationRuntimeState } from "../../../dashboard/src/v2/types.js";

describe("Chat Widget View Models", () => {
  describe("getChatWidgetData", () => {
    it("returns none if there is no metadata", () => {
      const message = {
        id: "msg_1",
        metadata: null,
      } as ChatMessageRecord;

      const result = getChatWidgetData(message);
      expect(result).toEqual({ type: "none", status: "completed", planName: "" });
    });

    it("returns planning if type is planning", () => {
      const message = {
        metadata: {
          type: "planning",
          status: "running",
          planName: "Test Plan"
        }
      } as unknown as ChatMessageRecord;

      const result = getChatWidgetData(message);
      expect(result).toEqual({ type: "planning", status: "running", planName: "Test Plan" });
    });

    it("returns planning if bodyMarkdown includes 'planning'", () => {
      const message = {
        bodyMarkdown: "I am planning the task now.",
        metadata: {
          status: "running",
          title: "My custom plan title"
        }
      } as unknown as ChatMessageRecord;

      const result = getChatWidgetData(message);
      expect(result).toEqual({ type: "planning", status: "running", planName: "My custom plan title" });
    });

    it("defaults to Execution Plan and completed if fields are missing on planning type", () => {
      const message = {
        metadata: {
          type: "planning"
        }
      } as unknown as ChatMessageRecord;

      const result = getChatWidgetData(message);
      expect(result).toEqual({ type: "planning", status: "completed", planName: "Execution Plan" });
    });
  });

  describe("getInvocationWidgetData", () => {
    it("returns planning if metadata.routeKind is virtual", () => {
      const message = {
        metadata: {
          routeKind: "virtual",
          status: "queued"
        }
      } as unknown as ExecutionInvocationMessageRecord;

      const result = getInvocationWidgetData(message);
      expect(result).toEqual({ type: "planning", status: "queued", planName: "Execution Plan" });
    });

    it("returns planning if metadata.routeKind is worker", () => {
      const message = {
        metadata: {
          routeKind: "worker",
          status: "failed",
          planName: "Worker Execution"
        }
      } as unknown as ExecutionInvocationMessageRecord;

      const result = getInvocationWidgetData(message);
      expect(result).toEqual({ type: "planning", status: "failed", planName: "Worker Execution" });
    });
  });

  describe("getWorkingBubbleData", () => {
    it("returns isPlanning: false when no runtime state", () => {
      const result = getWorkingBubbleData(null);
      expect(result).toEqual({ isPlanning: false });
    });

    it("returns isPlanning: true for virtual route", () => {
      const state: ConversationRuntimeState = {
        routeKind: "virtual"
      };
      const result = getWorkingBubbleData(state);
      expect(result.isPlanning).toBe(true);
      expect(result.planName).toBe("Execution Plan");
    });

    it("returns isPlanning: true for worker route with providerLabel", () => {
      const state: ConversationRuntimeState = {
        routeKind: "worker",
        providerLabel: "Anthropic"
      };
      const result = getWorkingBubbleData(state);
      expect(result.isPlanning).toBe(true);
      expect(result.planName).toBe("Task via Anthropic");
      expect(result.providerLabel).toBe("Anthropic");
    });

    it("returns isPlanning: true for continuationStatus === 'planning'", () => {
      const state: ConversationRuntimeState = {
        continuationStatus: "planning",
        modelLabel: "claude-3-opus"
      };
      const result = getWorkingBubbleData(state);
      expect(result.isPlanning).toBe(true);
      expect(result.modelLabel).toBe("claude-3-opus");
    });
  });
});