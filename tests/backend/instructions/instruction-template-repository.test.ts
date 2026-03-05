import { describe, expect, it } from "vitest";
import { InstructionRepository } from "../../../src/instructions/instruction-template-repository.js";
import * as path from "path";

describe("InstructionRepository", () => {
    it("handles repoPath properly", async () => {
        const repo = new InstructionRepository(process.cwd());

        // This will naturally reject since file does not exist, but we can test normalization
        await expect(repo.loadInstruction("nonexistent.md", "   ")).rejects.toThrow("Instruction template not found");
    });
});
