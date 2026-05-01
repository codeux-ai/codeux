import { describe, it, expect } from "vitest";
import { extractJsonFromText } from "../../../../src/domain/llm/json-extraction.js";

describe("json-extraction", () => {
  describe("extractJsonFromText", () => {
    it("should extract direct JSON object", () => {
      const text = `{"key": "value"}`;
      const result = extractJsonFromText(text);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ key: "value" });
      }
    });

    it("should extract direct JSON array", () => {
      const text = `[{"key": "value"}]`;
      const result = extractJsonFromText(text);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual([{ key: "value" }]);
      }
    });

    it("should extract JSON from markdown fenced block", () => {
      const text = `
Here is the JSON:
\`\`\`json
{
  "fenced": true
}
\`\`\`
      `;
      const result = extractJsonFromText(text);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ fenced: true });
      }
    });

    it("should extract JSON with leading and trailing text", () => {
      const text = `Leading text {"test": 123} trailing text`;
      const result = extractJsonFromText(text);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ test: 123 });
      }
    });

    it("should extract JSON containing escaped quotes and nested objects", () => {
      const text = `Some text {"test": "val\\"ue", "nested": {"key": [1, 2]}} more text`;
      const result = extractJsonFromText(text);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ test: 'val"ue', nested: { key: [1, 2] } });
      }
    });

    it("should return false for malformed JSON", () => {
      const text = `Here is my output {"missing": "quote} `;
      const result = extractJsonFromText(text);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toBe("Failed to extract valid JSON from text.");
      }
    });

    it("should handle empty text", () => {
      const result = extractJsonFromText("");
      expect(result.success).toBe(false);
    });

    it("should return the first valid JSON found", () => {
      const text = `Text {"a": 1} and then {"b": 2}`;
      const result = extractJsonFromText(text);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ a: 1 });
      }
    });
  });
});
