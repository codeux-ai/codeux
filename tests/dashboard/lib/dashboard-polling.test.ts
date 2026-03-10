import { describe, expect, it } from "vitest";
import { DEFAULT_POLL_INTERVAL_MS } from "../../../dashboard/src/hooks/use-dashboard-poll-manager.js";

describe("dashboard polling defaults", () => {
  it("uses a 30 second fallback poll interval", () => {
    expect(DEFAULT_POLL_INTERVAL_MS).toBe(30000);
  });
});
