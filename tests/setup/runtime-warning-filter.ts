const originalEmitWarning = process.emitWarning.bind(process);

process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
  const message = typeof warning === "string" ? warning : warning?.message ?? "";
  const type = warning instanceof Error
    ? warning.name
    : typeof args[0] === "string"
      ? args[0]
      : "";

  if (type === "ExperimentalWarning" && message.includes("SQLite is an experimental feature")) {
    return;
  }

  return originalEmitWarning(warning as never, ...(args as []));
}) as typeof process.emitWarning;
