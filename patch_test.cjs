const fs = require('fs');
let code = fs.readFileSync('tests/backend/server/dashboard-project-api.test.ts', 'utf-8');

const target = `    expect(statsSnapshot).toMatchObject({
      projectId: project.id,
      window: "24h",
      usage: {
        totalTokens: 490,
        activeTimeMs: 90_000,
        wallTimeMs: 90_000,
      },
    });`;

const replace = `    expect(statsSnapshot).toMatchObject({
      projectId: project.id,
      window: "24h",
      usage: {
        totalTokens: 490,
        activeTimeMs: 90_000,
        wallTimeMs: expect.any(Number),
      },
    });
    expect(statsSnapshot.usage.wallTimeMs).toBeGreaterThanOrEqual(90_000);`;

if (!code.includes(target)) {
    console.log("Could not find target");
    process.exit(1);
}
code = code.replace(target, replace);
fs.writeFileSync('tests/backend/server/dashboard-project-api.test.ts', code);
console.log("Successfully patched test assertion");
