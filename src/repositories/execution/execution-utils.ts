export { toNumber, parsePayloadJson } from "../repository-utils.js";

export function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

export function stripMarkdown(value: string): string {
  return value.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[`*~_]/g, "");
}
