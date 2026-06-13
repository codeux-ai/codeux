/**
 * Result of a realtime payload fingerprinting operation.
 */
export interface RealtimePayloadFingerprint {
  /**
   * A stable string representation of the payload with volatile fields removed.
   */
  fingerprint: string;
  /**
   * The size of the FULL payload in bytes (including volatile fields).
   */
  sizeBytes: number;
}

/**
 * Generates a stable fingerprint for a realtime payload, ignoring volatile fields
 * like updatedAt and timestamp, and calculates the total payload size in bytes.
 *
 * This helper ensures that duplicate detection and size logging use consistent
 * serialization logic and avoids scattered JSON.stringify calls.
 */
export function calculateRealtimeFingerprint(payload: unknown): RealtimePayloadFingerprint {
  if (payload === null || payload === undefined) {
    return { fingerprint: "", sizeBytes: 0 };
  }

  // We use a replacer to ignore volatile fields for the fingerprint.
  const fingerprint = JSON.stringify(payload, (key, value) => {
    if (key === "updatedAt" || key === "timestamp") {
      return undefined;
    }
    return value;
  });

  // We perform a full serialization to get the actual wire size.
  const fullJson = JSON.stringify(payload);
  const sizeBytes = Buffer.byteLength(fullJson, "utf8");

  return { fingerprint, sizeBytes };
}
