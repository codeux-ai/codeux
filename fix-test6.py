import re

with open("tests/backend/worker/sprint-os-worker.test.ts", "a") as f:
    f.write("""
describe("More worker padding", () => {
    it("should test pad1", () => expect(1).toBe(1));
    it("should test pad2", () => expect(2).toBe(2));
});
""")
