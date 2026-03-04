import * as fs from "fs/promises";

async function run() {
  const filepath = "tests/backend/infrastructure/providers/cli/docker-bootstrap-builder.test.ts";
  const content = await fs.readFile(filepath, "utf8");

  const lines = content.split("\n");
  const imports: string[] = [];
  const otherLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("import ")) {
      imports.push(line);
    } else {
      otherLines.push(line);
    }
  }

  const newContent = imports.join("\n") + "\n\n" + otherLines.join("\n");
  await fs.writeFile(filepath, newContent.trim() + "\n", "utf8");
}

run();
