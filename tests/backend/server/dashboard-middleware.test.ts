import { describe, expect, it } from "vitest";
import {
  DEFAULT_DASHBOARD_API_RATE_LIMIT_MAX,
  E2E_DASHBOARD_API_RATE_LIMIT_MAX_ENV,
  resolveDashboardApiRateLimitMax,
} from "../../../src/server/dashboard-middleware.js";

describe("resolveDashboardApiRateLimitMax", () => {
  it("keeps the production dashboard API limit when no E2E override is configured", () => {
    expect(resolveDashboardApiRateLimitMax({})).toBe(DEFAULT_DASHBOARD_API_RATE_LIMIT_MAX);
  });

  it("accepts a bounded override only in explicit E2E mode", () => {
    expect(resolveDashboardApiRateLimitMax({
      CODEUX_E2E_MODE: "1",
      [E2E_DASHBOARD_API_RATE_LIMIT_MAX_ENV]: "10000",
    })).toBe(10_000);
  });

  it("rejects an E2E override outside explicit E2E mode", () => {
    expect(() => resolveDashboardApiRateLimitMax({
      [E2E_DASHBOARD_API_RATE_LIMIT_MAX_ENV]: "10000",
    })).toThrow("restricted to CODEUX_E2E_MODE=1");
  });

  it.each(["599", "100001", "1000.5", "not-a-number"])(
    "rejects an invalid E2E override value %s",
    (value) => {
      expect(() => resolveDashboardApiRateLimitMax({
        CODEUX_E2E_MODE: "1",
        [E2E_DASHBOARD_API_RATE_LIMIT_MAX_ENV]: value,
      })).toThrow(E2E_DASHBOARD_API_RATE_LIMIT_MAX_ENV);
    },
  );
});
