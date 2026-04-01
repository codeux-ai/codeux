/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from "vitest";
import { mergeRefs } from "../../../dashboard/src/v2/utils/mergeRefs.js";

describe("mergeRefs", () => {
    it("should call function refs with the value", () => {
        const ref1 = vi.fn();
        const ref2 = vi.fn();
        const merged = mergeRefs(ref1, ref2);

        const node = document.createElement("div");
        merged(node);

        expect(ref1).toHaveBeenCalledWith(node);
        expect(ref2).toHaveBeenCalledWith(node);
    });

    it("should assign value to object refs", () => {
        const ref1 = { current: null };
        const ref2 = { current: null };
        const merged = mergeRefs(ref1, ref2);

        const node = document.createElement("div");
        merged(node as any);

        expect(ref1.current).toBe(node);
        expect(ref2.current).toBe(node);
    });

    it("should ignore null or undefined refs", () => {
        const ref1 = { current: null };
        const merged = mergeRefs(ref1, null, undefined);

        const node = document.createElement("div");
        merged(node as any);

        expect(ref1.current).toBe(node);
    });
});
