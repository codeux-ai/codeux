import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE_ROOTS = ["src", "dashboard/src"] as const;

async function collectOrigFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const matches = await Promise.all(entries.map(async (entry) => {
    const entryPath = join(root, entry.name);
    if (entry.isDirectory()) {
      return collectOrigFiles(entryPath);
    }
    return entry.isFile() && entry.name.endsWith(".orig") ? [entryPath] : [];
  }));

  return matches.flat();
}

describe("repository hygiene", () => {
  it("keeps editor and merge backup artifacts out of source trees", async () => {
    const origFiles = (await Promise.all(SOURCE_ROOTS.map(collectOrigFiles)))
      .flat()
      .map((filePath) => relative(process.cwd(), filePath))
      .sort();

    expect(origFiles).toEqual([]);
  });
});
