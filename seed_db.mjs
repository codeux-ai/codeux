import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';

// Try to find the app DB created by the dev server
const possiblePaths = [
  '.sprint-os/app.db',
  'local-data/app.db'
];

let dbPath = possiblePaths.find(p => fs.existsSync(p));
if (!dbPath) {
    console.log("No DB found, looking for anything ending in .db");
    // let's just create our own basic schema in local-data
    dbPath = 'local-data/app.db';
}

console.log("Using db:", dbPath);
const db = new Database(dbPath);

const projectId = '1769bbe2-5234-447e-a3d7-cf4e5f279fb9';

// Just in case schema isn't fully initialized by the app
try {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT,
      path TEXT,
      jules_api_key TEXT,
      created_at TEXT,
      updated_at TEXT
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS sprints (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      name TEXT,
      status TEXT,
      goal TEXT,
      start_date TEXT,
      showcase_pinned INTEGER,
      created_at TEXT,
      updated_at TEXT
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      sprint_id TEXT,
      name TEXT,
      status TEXT,
      created_at TEXT,
      updated_at TEXT
    )
  `).run();
} catch (e) {
  console.log("Error ensuring schema:", e);
}

// Ensure we have a project
try {
db.prepare(`
  INSERT OR IGNORE INTO projects (id, name, path, jules_api_key, created_at, updated_at)
  VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
`).run(projectId, 'Test Project', '/app', '');
} catch(e) {}

// Insert some sprints
for(let i = 0; i < 5; i++) {
  const sprintId = uuidv4();
  try {
    db.prepare(`
      INSERT INTO sprints (id, project_id, name, status, goal, start_date, showcase_pinned, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'), ?, datetime('now'), datetime('now'))
    `).run(sprintId, projectId, `Sprint ${i+1}`, i % 2 === 0 ? 'completed' : 'idle', `Goal for sprint ${i+1}`, i === 0 ? 1 : 0);

    // Update completion stats in sprint_stats table (if it exists, we'll just ignore if not)
    db.prepare(`INSERT INTO tasks (id, sprint_id, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`)
      .run(uuidv4(), sprintId, `Task ${i}`, i % 2 === 0 ? 'completed' : 'pending');
  } catch (e) {
     console.log("Failed to insert sprint/task", e);
  }
}

console.log("Database seeded.");
