import { describe, it, expect } from "vitest";
import {
  parseOptionalBoolean,
  parseOptionalInteger,
  requireTrimmedString,
  parseTrimmedString,
  parsePlanningOverrides,
  parsePreferredWorkerAssignment,
  parseResolveAttentionItemPayload,
  parseCreateDashboardConversationMessageInput,
  parseProjectStatsQuery,
  parseCreateProjectInput,
  parseProjectSetupRequestInput,
  parseUpdateProjectInput,
  parseCreateSprintInput,
  parseUpdateSprintInput,
  parseCreateTaskInput,
  parseUpdateTaskInput,
  parseCreateQuicksprintTemplateInput,
  parseUpdateQuicksprintTemplateInput,
  parseQuicksprintExecutionInput,
  parseThreadRouteInput,
  parseImprovePromptInput,
  parsePlanSprintOptions,
  parseRerunTaskOptions,
  parseClaimAttentionItemPayload,
  parseCreateConversationThreadInput,
  parseUpdateConversationThreadInput,
  parseStatsDateInput,
  DASHBOARD_DEFAULT_JSON_BODY_LIMIT,
  DASHBOARD_LARGE_SETTINGS_JSON_BODY_LIMIT,
  getDashboardJsonBodyLimit,
  isSupportedDashboardJsonContentType,
} from "../../../src/server/request-parsers.js";

describe("Request Parsers", () => {
  describe("dashboard JSON body policy", () => {
    it("uses the small default JSON body limit for normal API mutations", () => {
      expect(DASHBOARD_DEFAULT_JSON_BODY_LIMIT).toBe("1mb");
      expect(getDashboardJsonBodyLimit("POST", "/api/projects/project-1/tasks")).toBe("default");
      expect(getDashboardJsonBodyLimit("PATCH", "/api/tasks/task-1")).toBe("default");
    });

    it("keeps the large JSON body limit scoped to settings routes that can carry appearance images", () => {
      expect(DASHBOARD_LARGE_SETTINGS_JSON_BODY_LIMIT).toBe("25mb");
      expect(getDashboardJsonBodyLimit("PUT", "/api/system-settings")).toBe("large");
      expect(getDashboardJsonBodyLimit("PUT", "/api/projects/project-1/settings")).toBe("large");
      expect(getDashboardJsonBodyLimit("PUT", "/api/sprints/sprint-1/settings")).toBe("large");
    });

    it("bypasses JSON parsing for upload, preview proxy, reads, and non-runtime paths", () => {
      expect(getDashboardJsonBodyLimit("POST", "/api/projects/project-1/knowledge/documents/upload")).toBeNull();
      expect(getDashboardJsonBodyLimit("POST", "/api/browser/sessions/session-1/proxy/api/comment")).toBeNull();
      expect(getDashboardJsonBodyLimit("GET", "/api/system-settings")).toBeNull();
      expect(getDashboardJsonBodyLimit("POST", "/assets/index.js")).toBeNull();
    });

    it("accepts JSON media types and rejects ambiguous alternatives", () => {
      expect(isSupportedDashboardJsonContentType("application/json")).toBe(true);
      expect(isSupportedDashboardJsonContentType("application/json; charset=utf-8")).toBe(true);
      expect(isSupportedDashboardJsonContentType("application/vnd.codeux+json")).toBe(true);
      expect(isSupportedDashboardJsonContentType("text/plain;charset=UTF-8")).toBe(false);
      expect(isSupportedDashboardJsonContentType("multipart/form-data; boundary=abc")).toBe(false);
      expect(isSupportedDashboardJsonContentType(undefined)).toBe(false);
    });
  });

  describe("Validation Helpers", () => {
    it("parseOptionalBoolean rejects invalid forms", () => {
      expect(() => parseOptionalBoolean("yes")).toThrow();
      expect(() => parseOptionalBoolean({})).toThrow();
      expect(() => parseOptionalBoolean([])).toThrow();
    });
    it("parseOptionalBoolean accepts strings, numbers and booleans", () => {
      expect(parseOptionalBoolean("true")).toBe(true);
      expect(parseOptionalBoolean("false")).toBe(false);
      expect(parseOptionalBoolean("1")).toBe(true);
      expect(parseOptionalBoolean("0")).toBe(false);
      expect(parseOptionalBoolean(1)).toBe(true);
      expect(parseOptionalBoolean(0)).toBe(false);
      expect(parseOptionalBoolean(true)).toBe(true);
      expect(parseOptionalBoolean(false)).toBe(false);
      expect(parseOptionalBoolean(null)).toBeUndefined();
      expect(parseOptionalBoolean(undefined)).toBeUndefined();
    });

    it("parseOptionalBoolean rejects empty strings instead of silently coercing", () => {
      expect(() => parseOptionalBoolean("")).toThrow("Invalid boolean value for field.");
      expect(() => parseOptionalBoolean("   ", "enabled")).toThrow("Invalid boolean value for enabled.");
    });

    it("parseOptionalInteger handles strings, numbers, flooring, and throws on invalid boundaries and formats", () => {
      expect(parseOptionalInteger(2.8)).toBe(2);
      expect(parseOptionalInteger("5")).toBe(5);
      expect(parseOptionalInteger("-5", -10, 10)).toBe(-5);
      expect(() => parseOptionalInteger(11, 1, 10)).toThrow(/between/);
      expect(() => parseOptionalInteger(-1, 1, 10)).toThrow(/between/);
      expect(() => parseOptionalInteger("")).toThrow(/valid integer/);
      expect(() => parseOptionalInteger("foo")).toThrow(/valid integer/);
      expect(() => parseOptionalInteger(NaN)).toThrow(/valid integer/);
      expect(() => parseOptionalInteger(Infinity)).toThrow(/valid integer/);
      expect(() => parseOptionalInteger({})).toThrow(/valid integer/);
    });

    it("parseOptionalInteger preserves nullable fields and enforces inclusive integer bounds", () => {
      expect(parseOptionalInteger(null, 1, 5, "count")).toBeUndefined();
      expect(parseOptionalInteger(undefined, 1, 5, "count")).toBeUndefined();
      expect(parseOptionalInteger("1", 1, 5, "count")).toBe(1);
      expect(parseOptionalInteger("5", 1, 5, "count")).toBe(5);
      expect(() => parseOptionalInteger("0", 1, 5, "count")).toThrow("Invalid value for count. Must be between 1 and 5.");
      expect(() => parseOptionalInteger("6", 1, 5, "count")).toThrow("Invalid value for count. Must be between 1 and 5.");
    });
  });

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
  describe("parseProjectStatsQuery", () => {
    it("returns 7d as default when window is absent or invalid", () => {
      expect(parseProjectStatsQuery({}).window).toBe("7d");
      expect(parseProjectStatsQuery({ window: "unknown" }).window).toBe("7d");
    });

    it("parses valid limits and rejects unbounded ones", () => {
      expect(parseProjectStatsQuery({ limit: 50 }).limit).toBe(50);
      expect(parseProjectStatsQuery({ limit: "50" }).limit).toBe(50);
      expect(() => parseProjectStatsQuery({ limit: 100000 })).toThrow(/between/);
    });

    it("validates and formats custom ranges", () => {
      const result = parseProjectStatsQuery({ window: "custom", from: "2024-01-01", to: "2024-01-31" });
      expect(result.window).toBe("custom");
      expect(result.from).toBe("2024-01-01T00:00:00.000Z");
      expect(result.to).toBe("2024-01-31T23:59:59.999Z");
    });

    it("rejects unreasonable future and past ranges", () => {
      expect(() => parseProjectStatsQuery({ window: "custom", from: "1990-01-01", to: "2024-01-01" })).toThrow(/outside historical\/future bounds/);
      expect(() => parseProjectStatsQuery({ window: "custom", from: "2024-01-01", to: "2100-01-01" })).toThrow(/outside historical\/future bounds/);
    });

    it("rejects invalid or missing bounds for custom", () => {
      expect(() => parseProjectStatsQuery({ window: "custom" })).toThrow();
      expect(() => parseProjectStatsQuery({ window: "custom", from: "  ", to: "" })).toThrow();
      expect(() => parseProjectStatsQuery({ window: "custom", from: "invalid", to: "2024-01-01" })).toThrow();
    });

    it("rejects reversed bounds", () => {
      expect(() => parseProjectStatsQuery({ window: "custom", from: "2024-02-01", to: "2024-01-01" })).toThrow();
    });
  });

  describe("parseTrimmedString", () => {
    it("trims strings and drops empty/non-string values", () => {
      expect(parseTrimmedString("  hi  ")).toBe("hi");
      expect(parseTrimmedString("   ")).toBeUndefined();
      expect(parseTrimmedString(5)).toBeUndefined();
    });
  });

  describe("parseCreateProjectInput", () => {
    it("parses a valid local project", () => {
      const result = parseCreateProjectInput({ name: " My Proj ", sourceType: "local", sourceRef: " /path ", isPrivate: 1 });
      expect(result).toMatchObject({ name: "My Proj", sourceType: "local", sourceRef: "/path", isPrivate: true });
    });

    it("rejects a non-object body", () => {
      expect(() => parseCreateProjectInput(null)).toThrow(/body must be an object/);
    });

    it("requires name, sourceType and sourceRef", () => {
      expect(() => parseCreateProjectInput({})).toThrow(/required field: name/);
      expect(() => parseCreateProjectInput({ name: "n" })).toThrow(/sourceType/);
      expect(() => parseCreateProjectInput({ name: "n", sourceType: "local" })).toThrow(/sourceRef/);
    });

    it("rejects invalid enum values", () => {
      expect(() => parseCreateProjectInput({ name: "n", sourceType: "ftp", sourceRef: "r" })).toThrow(/sourceType/);
      expect(() => parseCreateProjectInput({ name: "n", sourceType: null, sourceRef: "r" })).toThrow(/sourceType/);
      expect(() => parseCreateProjectInput({ name: "n", sourceType: "", sourceRef: "r" })).toThrow(/sourceType/);
    });
  });

  describe("parseProjectSetupRequestInput", () => {
    it("parses setup option booleans including techstack", () => {
      expect(parseProjectSetupRequestInput({
        enabled: true,
        clientRequestId: " setup-1 ",
        options: {
          agents: "true",
          quicksprints: "false",
          previewScript: 1,
          ci: 0,
          techstack: true,
        },
      })).toEqual({
        enabled: true,
        clientRequestId: "setup-1",
        options: {
          agents: true,
          quicksprints: false,
          previewScript: true,
          ci: false,
          techstack: true,
        },
      });
    });

    it("rejects invalid setup option booleans", () => {
      expect(() => parseProjectSetupRequestInput({
        options: { techstack: "yes" },
      })).toThrow(/setup.options.techstack/);
    });
  });

  describe("parseUpdateProjectInput", () => {
    it("passes through optional fields and preserves explicit nulls", () => {
      const result = parseUpdateProjectInput({ name: "n", defaultBranch: null, featureBranchPrefix: "feat/" });
      expect(result.defaultBranch).toBeNull();
      expect(result.featureBranchPrefix).toBe("feat/");
    });

    it("drops empty optional strings while preserving nullable project fields", () => {
      const result = parseUpdateProjectInput({
        name: "   ",
        sourceRef: "",
        defaultBranch: null,
        featureBranchPrefix: null,
      });

      expect(result.name).toBe("");
      expect(result.sourceRef).toBe("");
      expect(result.defaultBranch).toBeNull();
      expect(result.featureBranchPrefix).toBeNull();
    });

    it("rejects a non-object body", () => {
      expect(() => parseUpdateProjectInput(42)).toThrow(/body must be an object/);
    });
  });

  describe("sprint parsers", () => {
    it("treats missing, null, and blank sprint names as unset on create", () => {
      expect(parseCreateSprintInput({}).name).toBeUndefined();
      expect(parseCreateSprintInput({ name: null }).name).toBeUndefined();
      expect(parseCreateSprintInput({ name: "   " }).name).toBeUndefined();
    });

    it("parses create sprint fields including null coercion", () => {
      const result = parseCreateSprintInput({ name: "Sprint", originalPrompt: null, number: 3, status: "running" });
      expect(result).toMatchObject({ name: "Sprint", originalPrompt: null, number: 3, status: "running" });
    });

    it("parses update sprint with a numeric string number", () => {
      const result = parseUpdateSprintInput({ number: "7", showcasePinned: true });
      expect(result.number).toBe(7);
      expect(result.showcasePinned).toBe(true);
    });

    it("rejects invalid sprint enums and out-of-range numbers", () => {
      expect(() => parseCreateSprintInput({ status: "blocked" })).toThrow(/status/);
      expect(() => parseUpdateSprintInput({ status: "blocked" })).toThrow(/status/);
      expect(() => parseCreateSprintInput({ number: 1000001 })).toThrow(/between -1000000 and 1000000/);
      expect(() => parseUpdateSprintInput({ number: -1000001 })).toThrow(/between -1000000 and 1000000/);
    });
  });

  describe("task parsers", () => {
    it("requires sprintId and title on create", () => {
      expect(() => parseCreateTaskInput({ title: "t" })).toThrow(/sprintId/);
      expect(() => parseCreateTaskInput({ sprintId: "s" })).toThrow(/title/);
    });

    it("parses create task with dependencies and enums", () => {
      const result = parseCreateTaskInput({
        sprintId: "s", title: "t", priority: "high", status: "pending", dependsOnTaskIds: ["1", "x"],
      });
      expect(result.dependsOnTaskIds).toEqual(["1", "x"]);
      expect(result.priority).toBe("high");
    });

    it("rejects non-string dependencies", () => {
      expect(() => parseCreateTaskInput({ sprintId: "s", title: "t", dependsOnTaskIds: [1, "x"] })).toThrow(/dependency array/);
    });


    it("rejects an invalid task priority", () => {
      expect(() => parseCreateTaskInput({ sprintId: "s", title: "t", priority: "urgent" })).toThrow(/priority/);
      expect(() => parseUpdateTaskInput({ executorType: "manual" })).toThrow(/executorType/);
    });

    it("parses update task optional fields", () => {
      const result = parseUpdateTaskInput({ title: "t2", agentPresetId: null, sortOrder: 2 });
      expect(result.agentPresetId).toBeNull();
      expect(result.sortOrder).toBe(2);
    });
  });

  describe("quicksprint parsers", () => {
    it("requires all template fields on create", () => {
      expect(() => parseCreateQuicksprintTemplateInput({ name: "n" })).toThrow(/description/);
    });

    it("parses a full create template input", () => {
      const result = parseCreateQuicksprintTemplateInput({
        name: "n", description: "d", icon: "i", category: "c", agentInstructionMarkdown: "md", defaultTaskCount: 4,
      });
      expect(result).toMatchObject({ name: "n", defaultTaskCount: 4 });
    });

    it("parses update template input", () => {
      expect(parseUpdateQuicksprintTemplateInput({ name: " n " })).toMatchObject({ name: "n" });
    });

    it("validates execution input", () => {
      expect(() => parseQuicksprintExecutionInput({ templateId: "t", taskCount: 0, submitMode: "plan_only" })).toThrow(/between/);
      expect(() => parseQuicksprintExecutionInput({ templateId: "t", taskCount: 2000, submitMode: "plan_only" })).toThrow(/between/);
      expect(() => parseQuicksprintExecutionInput({ templateId: "t", taskCount: 2, submitMode: "bad" })).toThrow(/submitMode/);
      expect(parseQuicksprintExecutionInput({ templateId: "t", taskCount: 2.8, submitMode: "plan_and_start" })).toMatchObject({ taskCount: 2, submitMode: "plan_and_start" });
      expect(parseQuicksprintExecutionInput({ templateId: "t", taskCount: "2", submitMode: "plan_and_start" })).toMatchObject({ taskCount: 2, submitMode: "plan_and_start" });
      expect(parseQuicksprintExecutionInput({ templateId: "t", submitMode: "plan_only", noTaskLimit: true })).toMatchObject({ taskCount: 5, noTaskLimit: true, submitMode: "plan_only" });
    });

    it("does not let noTaskLimit bypass invalid boolean coercion", () => {
      expect(() => parseQuicksprintExecutionInput({ templateId: "t", submitMode: "plan_only", noTaskLimit: "yes" })).toThrow(/Invalid boolean value/);
    });
  });

  describe("parseThreadRouteInput", () => {
    it("requires a valid routeKind", () => {
      expect(() => parseThreadRouteInput({ routeKind: "nope" })).toThrow(/routeKind/);
    });

    it("parses a virtual route", () => {
      expect(parseThreadRouteInput({ routeKind: "virtual", virtualProvider: " gemini ", virtualModel: " m " })).toEqual({
        routeKind: "virtual", virtualProvider: "gemini", virtualModel: "m", workerEndpointId: undefined,
      });
    });
  });

  describe("parseImprovePromptInput / parsePlanSprintOptions", () => {
    it("parses improve prompt with overrides", () => {
      const result = parseImprovePromptInput({ name: " N ", goal: "g", overrides: { workerId: "w1" } });
      expect(result).toMatchObject({ name: "N", goal: "g", overrides: { workerId: "w1" } });
    });

    it("parses plan sprint options as booleans", () => {
      expect(parsePlanSprintOptions({ autoStart: 1, replan: 0 })).toMatchObject({ autoStart: true, replan: false });
      expect(parsePlanSprintOptions({ autoStart: "false", replan: "true" })).toMatchObject({ autoStart: false, replan: true });
      expect(() => parsePlanSprintOptions({ autoStart: "yes" })).toThrow(/Invalid boolean value/);
    });

    it("rejects non-object bodies", () => {
      expect(() => parseImprovePromptInput(null)).toThrow(/body must be an object/);
      expect(() => parsePlanSprintOptions("x")).toThrow(/body must be an object/);
    });
  });

  describe("parseRerunTaskOptions & attention payloads", () => {
    it("coerces rerun task flags", () => {
      expect(parseRerunTaskOptions({ provider: "codex", clearWorktree: 1, undoMerge: true, resetDependents: "false" })).toMatchObject({
        provider: "codex", clearWorktree: true, resetDependents: false, undoMerge: true,
      });
      expect(() => parseRerunTaskOptions({ clearWorktree: "invalid" })).toThrow(/Invalid boolean value/);
    });

    it("parses claim attention payloads", () => {
      expect(parseClaimAttentionItemPayload({ workerEndpointId: " w ", claimReason: " busy " })).toEqual({
        workerEndpointId: "w", claimReason: "busy",
      });
    });
  });

  describe("conversation thread parsers", () => {
    it("requires a title and validates scope", () => {
      expect(() => parseCreateConversationThreadInput({})).toThrow(/required field: title/);
      expect(() => parseCreateConversationThreadInput({ title: "t", scope: "bad" })).toThrow(/scope/);
    });

    it("parses a create thread input with explicit null connection", () => {
      expect(parseCreateConversationThreadInput({ title: " t ", connectionId: null, scope: "project" })).toMatchObject({
        title: "t", connectionId: null, scope: "project",
      });
    });

    it("parses an update thread input", () => {
      expect(parseUpdateConversationThreadInput({ connectionId: " c " })).toMatchObject({ connectionId: "c" });
    });
  });

  describe("parseStatsDateInput", () => {
    it("returns null for empty input", () => {
      expect(parseStatsDateInput(undefined, "start")).toBeNull();
      expect(parseStatsDateInput("   ", "end")).toBeNull();
    });

    it("expands a bare date to the start/end of day in UTC", () => {
      expect(parseStatsDateInput("2024-03-04", "start")?.toISOString()).toBe("2024-03-04T00:00:00.000Z");
      expect(parseStatsDateInput("2024-03-04", "end")?.toISOString()).toBe("2024-03-04T23:59:59.999Z");
    });

    it("parses a full timestamp and rejects garbage", () => {
      expect(parseStatsDateInput("2024-03-04T12:00:00Z", "start")?.toISOString()).toBe("2024-03-04T12:00:00.000Z");
      expect(parseStatsDateInput("not-a-date", "start")).toBeNull();
    });
  });
});
