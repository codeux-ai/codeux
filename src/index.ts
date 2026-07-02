#!/usr/bin/env node
import { installRuntimeWarningFilter } from "./runtime-warning-filter.js";
import { buildHelpText, parseCliInvocation } from "./cli/cli-args.js";

installRuntimeWarningFilter();

export async function main(args: string[] = process.argv): Promise<void> {
  const [
    dotenv,
    path,
    { fileURLToPath },
    { loadAppConfig },
    { CodeUxServer },
    { fixDockerHostEnvironment },
  ] = await Promise.all([
    import("dotenv"),
    import("path"),
    import("url"),
    import("./config/app-config.js"),
    import("./server/code-ux-server.js"),
    import("./shared/docker-env-helper.js"),
  ]);

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const projectRoot = path.resolve(__dirname, "..");

  dotenv.config({ path: path.join(projectRoot, ".env"), quiet: true });
  await fixDockerHostEnvironment();
  const appConfig = loadAppConfig(args, projectRoot);
  const invocation = parseCliInvocation(args);

  if (invocation.management && !invocation.globalHelpRequested) {
    const { runManagementCli } = await import("./cli/management-cli.js");
    const handled = await runManagementCli({
      invocation,
      projectRoot,
      appConfig,
    });
    if (handled) {
      return;
    }
  }

  if (args.includes("--help") || args.includes("-h")) {
    const helpText = buildHelpText(appConfig);
    const [headline, ...rest] = helpText.split("\n");
    console.log(headline);
    if (rest.length > 0) {
      console.log(rest.join("\n"));
    }
    process.exit(0);
  }

  const server = new CodeUxServer({ projectRoot, appConfig });

  try {
    await server.run();
  } catch (error) {
    console.error("Fatal error starting server:", error);
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== "test") {
  main().catch((error) => {
    console.error("Unhandled error in main:", error);
    process.exit(1);
  });
}
