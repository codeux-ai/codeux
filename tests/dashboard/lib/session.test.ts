import { describe, expect, it } from "vitest";
import { normalizeSessionName } from "../../../dashboard/src/lib/session.js";

describe("normalizeSessionName", () => {
  it("returns session_name if it starts with sessions/", () => {
    expect(normalizeSessionName({ session_name: "sessions/123", session_id: 123 })).toBe("sessions/123");
  });

  it("returns prefixed session_id if no valid session_name", () => {
    expect(normalizeSessionName({ session_id: 123 })).toBe("sessions/123");
  });

  it("handles string session_id without prefix", () => {
    expect(normalizeSessionName({ session_id: "123" })).toBe("sessions/123");
  });

  it("handles string session_id with prefix", () => {
    expect(normalizeSessionName({ session_id: "sessions/123" })).toBe("sessions/123");
  });

  it("returns null if neither is provided", () => {
    expect(normalizeSessionName({})).toBe(null);
  });
});
