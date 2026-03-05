import { describe, expect, it } from "vitest";
import { extractPathHints, isReadFileNotFoundToolError, buildReadFileRetryPrompt } from "../../../src/services/cli-workflow-text-utils.js";

describe("cli-workflow-text-utils", () => {
    describe("extractPathHints", () => {
        it("extracts from backticks", () => {
            const res = extractPathHints("Check out `src/index.ts` and `package.json`");
            expect(res).toEqual(expect.arrayContaining(["src/index.ts", "package.json"]));
        });

        it("extracts from line matches", () => {
            const res = extractPathHints("Files:\n - src/test.ts\n - another/file.js");
            expect(res).toEqual(expect.arrayContaining(["src/test.ts", "another/file.js"]));
        });

        it("filters out invalid paths", () => {
            const longString = "a".repeat(181);
            const res = extractPathHints(`- /absolute/path\n- ~/home\n- ../parent\n- ${longString}\n- no_extension_no_slash`);
            expect(res).toHaveLength(0);
        });

        it("cleans trailing punctuation", () => {
            const res = extractPathHints("See `src/index.ts`");
            expect(res).toEqual(["src/index.ts"]);
        });
    });

    it("isReadFileNotFoundToolError", () => {
        expect(isReadFileNotFoundToolError({ stdout: "error executing tool read_file: file not found", stderr: "", exitCode: 1 } as any)).toBe(true);
        expect(isReadFileNotFoundToolError({ stdout: "other error", stderr: "", exitCode: 1 } as any)).toBe(false);
    });

    it("buildReadFileRetryPrompt", () => {
        const res = buildReadFileRetryPrompt("base");
        expect(res).toContain("base");
        expect(res).toContain("Retry Guidance");
        expect(res).toContain("file-not-found");
    });
});
