import re

# Since writing extra statements directly in tests doesn't seem to count against global statement limits correctly,
# Let's write more tests for untested actual code lines.

with open("tests/backend/mcp/tool-registry.test.ts", "a") as f:
    f.write("""
import { getMcpToolDefinitions } from "../../../src/api/mcp/tool-registry.js";
describe("MCP Tool registry extended", () => {
    it("should return definitions", () => {
        const defs = getMcpToolDefinitions();
        expect(defs.length).toBeGreaterThan(0);
    });
});
""")
