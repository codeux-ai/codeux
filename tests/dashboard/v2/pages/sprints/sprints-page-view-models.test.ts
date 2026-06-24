import { describe, it, expect } from "vitest";
import {
  buildPlanningConnection,
  buildPlanningRoute,
  buildDisplaySprints,
  countSprintsByStatus,
  countInWorkSprints,
} from "../../../../../dashboard/src/v2/pages/sprints/sprints-page-view-models.js";
import type { Sprint } from "../../../../../dashboard/src/v2/types.js";
import type { ConnectionState } from "../../../../../dashboard/src/types.js";

describe("Sprints Page View Models", () => {
  describe("buildPlanningConnection", () => {
    it("orders by role priority then status priority", () => {
      const connections: ConnectionState[] = [
        { id: "1", role: "listener", status: "connected", listenMode: true, displayName: "A", metadata: {} } as ConnectionState,
        { id: "2", role: "worker", status: "connected", listenMode: true, displayName: "B", metadata: {} } as ConnectionState,
        { id: "3", role: "worker", status: "listening", listenMode: true, displayName: "C", metadata: {} } as ConnectionState,
      ];
      const selected = buildPlanningConnection(connections);
      // worker online should be top
      expect(selected?.id).toBe("3");
    });
  });

  describe("buildPlanningRoute", () => {
    it("returns virtual worker label if virtual mode", () => {
      const result = buildPlanningRoute(null, { executionMode: "VIRTUAL", virtualWorkerProvider: "gemini" });
      expect(result.available).toBe(true);
      expect(result.label).toBe("Gemini Primary");
    });

    it("returns connection display name if no virtual mode and connection exists", () => {
      const connection = { displayName: "Local Worker" } as ConnectionState;
      const result = buildPlanningRoute(connection, { executionMode: "MANUAL" });
      expect(result.available).toBe(true);
      expect(result.label).toBe("Local Worker");
    });

    it("returns unavailable if no connection and manual mode", () => {
      const result = buildPlanningRoute(null, { executionMode: "MANUAL" });
      expect(result.available).toBe(false);
      expect(result.label).toBeNull();
    });
  });

  describe("buildDisplaySprints", () => {
    it("overrides status based on optimistic statuses", () => {
      const sprints = [{ id: "1", status: "running" }] as Sprint[];
      const optimistic = { "1": "running" };
      const suppressed = new Set<string>();
      const result = buildDisplaySprints(sprints, optimistic, suppressed);
      expect(result[0].status).toBe("running");
    });

    it("cancels running status if sprint is suppressed", () => {
      const sprints = [{ id: "1", status: "running" }] as Sprint[];
      const optimistic = {};
      const suppressed = new Set(["1"]);
      const result = buildDisplaySprints(sprints, optimistic, suppressed);
      expect(result[0].status).toBe("cancelled");
    });
  });

  describe("Sprint Counts", () => {
    it("counts sprints by status", () => {
      const sprints = [
        { id: "1", status: "completed" },
        { id: "2", status: "completed" },
        { id: "3", status: "running" },
      ] as Sprint[];
      expect(countSprintsByStatus(sprints, "completed")).toBe(2);
      expect(countInWorkSprints(sprints)).toBe(1);
    });
  });
});
