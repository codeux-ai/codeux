#!/usr/bin/env node
import dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";
import { loadAppConfig } from "./config/app-config.js";
import { JulesAgentServer } from "./server/jules-agent-server.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

dotenv.config({ path: path.join(projectRoot, ".env") });

const appConfig = loadAppConfig(process.argv, projectRoot);
const server = new JulesAgentServer({ projectRoot, appConfig });

server.run().catch((error) => {
  console.error("Fatal error starting server:", error);
  process.exit(1);
});
