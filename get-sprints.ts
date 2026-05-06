import { AppDbStorage } from "./src/repositories/app-db-storage.js";
import path from "path";

async function main() {
  const dbPath = path.resolve(".code-ux/data.db");
  const storage = new AppDbStorage(dbPath);
  const db = storage.getDatabase();
  
  try {
    const sprints = db.prepare("SELECT * FROM sprints").all();
    console.log("SPRINTS:");
    console.log(JSON.stringify(sprints, null, 2));
  } catch (e) {
    console.log("Error querying sprints:", e.message);
  }

  try {
    const projects = db.prepare("SELECT * FROM projects").all();
    console.log("PROJECTS:");
    console.log(JSON.stringify(projects, null, 2));
  } catch (e) {
    console.log("Error querying projects:", e.message);
  }
}

main().catch(console.error);
