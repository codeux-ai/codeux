import { describe, expect, it } from "vitest";
import { formatInvocationRetryAt } from "../../../dashboard/src/v2/lib/invocation-retry-time.js";

describe("formatInvocationRetryAt", () => {
  it("formats retry timestamps in the requested user timezone", () => {
    expect(formatInvocationRetryAt("2026-07-04T22:33:21.418Z", "Europe/Berlin"))
      .toBe("Jul 5, 00:33 GMT+2");
  });

  it("returns null for missing or invalid timestamps", () => {
    expect(formatInvocationRetryAt(null, "Europe/Berlin")).toBeNull();
    expect(formatInvocationRetryAt("not-a-date", "Europe/Berlin")).toBeNull();
  });
});
