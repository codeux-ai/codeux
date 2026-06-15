import { describe, it, expect } from "vitest";
import {
  requireTrimmedString,
  parsePlanningOverrides,
  parsePreferredWorkerAssignment,
  parseResolveAttentionItemPayload,
  parseCreateDashboardConversationMessageInput,
} from "../../../src/server/request-parsers.js";

describe("Request Parsers", () => {
  describe("requireTrimmedString", () => {
    it("should reject non-strings, null, undefined, or empty strings", () => {
      expect(() => requireTrimmedString(null, "testField")).toThrow("Missing or empty required field: testField");
      expect(() => requireTrimmedString(undefined, "testField")).toThrow("Missing or empty required field: testField");
      expect(() => requireTrimmedString("", "testField")).toThrow("Missing or empty required field: testField");
      expect(() => requireTrimmedString("   ", "testField")).toThrow("Missing or empty required field: testField");
      expect(() => requireTrimmedString(123, "testField")).toThrow("Missing or empty required field: testField");
    });

    it("should return the trimmed string", () => {
      expect(requireTrimmedString("  hello  ", "testField")).toBe("hello");
      expect(requireTrimmedString("world", "testField")).toBe("world");
    });
  });

  describe("parsePlanningOverrides", () => {
    it("should return undefined for invalid input", () => {
      expect(parsePlanningOverrides(null)).toBeUndefined();
      expect(parsePlanningOverrides(undefined)).toBeUndefined();
      expect(parsePlanningOverrides(123)).toBeUndefined();
      expect(parsePlanningOverrides("string")).toBeUndefined();
    });

    it("should normalize and trim fields", () => {
      const overrides = parsePlanningOverrides({
        workerId: "   w123   ",
        virtualProvider: "   anthropic  ",
        virtualModel: " claude-3-5 ",
        planningAgentPresetId: "  preset1  ",
        agentRoutingMode: "MANUAL",
        workerAgentPresetId: "  preset2  "
      });
      expect(overrides).toEqual({
        workerId: "w123",
        virtualProvider: "anthropic",
        virtualModel: "claude-3-5",
        planningAgentPresetId: "preset1",
        agentRoutingMode: "MANUAL",
        workerAgentPresetId: "preset2"
      });
    });

    it("should ignore invalid routing mode", () => {
      const overrides = parsePlanningOverrides({
        agentRoutingMode: "INVALID_MODE",
      });
      expect(overrides).toBeUndefined(); // Returns undefined if no valid properties
    });

    it("should ignore empty strings", () => {
      const overrides = parsePlanningOverrides({
        workerId: "   ",
        virtualProvider: "",
      });
      expect(overrides).toBeUndefined();
    });
  });

  describe("parsePreferredWorkerAssignment", () => {
    it("should clear to null when passed null, and keep strings trimmed", () => {
      const result = parsePreferredWorkerAssignment({
        workerConnectionId: null,
        workerEndpointId: "  conn-123  ",
        workerEndpointKey: "   ", // whitespace only should become undefined, not null! Wait let's check code
      });
      expect(result.workerConnectionId).toBeNull();
      expect(result.workerEndpointId).toBe("conn-123");
      expect(result.workerEndpointKey).toBeNull(); // Wait, the parserNullable returns null for whitespace only strings!
    });

    it("should throw for invalid input", () => {
      expect(() => parsePreferredWorkerAssignment(null)).toThrow("Invalid input: body must be an object");
    });
  });

  describe("parseResolveAttentionItemPayload", () => {
    it("should reject invalid status", () => {
      expect(() => parseResolveAttentionItemPayload({ status: "invalid" })).toThrow("Invalid status. Must be 'resolved' or 'dismissed'.");
      expect(() => parseResolveAttentionItemPayload({})).toThrow("Invalid status. Must be 'resolved' or 'dismissed'.");
      expect(() => parseResolveAttentionItemPayload(null)).toThrow("Invalid input: body must be an object");
    });

    it("should accept valid statuses", () => {
      expect(parseResolveAttentionItemPayload({ status: "resolved", reason: "done" })).toEqual({
        status: "resolved",
        reason: "done",
        resolutionSummaryMarkdown: undefined
      });
      expect(parseResolveAttentionItemPayload({ status: "dismissed" })).toEqual({
        status: "dismissed",
        reason: undefined,
        resolutionSummaryMarkdown: undefined
      });
    });
  });

  describe("parseCreateDashboardConversationMessageInput", () => {
    it("should throw if bodyMarkdown is missing or empty", () => {
      expect(() => parseCreateDashboardConversationMessageInput({}))
        .toThrow("Missing or empty required field: bodyMarkdown");
      expect(() => parseCreateDashboardConversationMessageInput({ bodyMarkdown: "   " }))
        .toThrow("Missing or empty required field: bodyMarkdown");
      expect(() => parseCreateDashboardConversationMessageInput(null)).toThrow("Invalid input: body must be an object");
    });

    it("should parse correctly with valid inputs", () => {
      const result = parseCreateDashboardConversationMessageInput({
        bodyMarkdown: "  Hello World  ",
        threadId: " thread-123 ",
        title: " My Title ",
        connectionId: null,
        metadata: { some: "data" }
      });

      expect(result).toEqual({
        bodyMarkdown: "Hello World",
        threadId: "thread-123",
        title: "My Title",
        connectionId: null,
        metadata: { some: "data" }
      });
    });
  });
});
