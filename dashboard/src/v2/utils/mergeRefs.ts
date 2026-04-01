import type { Ref } from "preact";

export function mergeRefs<T>(...refs: Array<Ref<T> | null | undefined>) {
    return (value: T | null) => {
        refs.forEach((ref) => {
            if (typeof ref === "function") {
                ref(value);
            } else if (ref != null && "current" in ref) {
                (ref as import("preact/hooks").MutableRef<T | null>).current = value;
            }
        });
    };
}
