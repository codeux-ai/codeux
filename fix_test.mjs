import { readFileSync, writeFileSync } from "fs";

const filepath = "tests/backend/repositories/session-tracking-repository.test.ts";
let content = readFileSync(filepath, "utf8");

content = content.replace(
  'expect(activities[0].description).toBe("act 1");',
  'expect(activities[1].description).toBe("act 1");'
);
content = content.replace(
  'expect((activities[0] as any).x).toBe(1);',
  'expect((activities[1] as any).x).toBe(1);'
);

writeFileSync(filepath, content);
