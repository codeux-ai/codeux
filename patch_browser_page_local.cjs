const fs = require('fs');
const file = 'dashboard/src/v2/BrowserPage.tsx';
let code = fs.readFileSync(file, 'utf8');

// Add local action feedback state and remove frameKey
code = code.replace(
  `  const [frameKey, setFrameKey] = useState(0);`,
  `  const [actionFeedback, setActionFeedback] = useState<{status: 'idle' | 'pending' | 'success' | 'error', message: string | null}>({status: 'idle', message: null});`
);

code = code.replace(/setFrameKey\(\(current\) => current \+ 1\);/g, "");
code = code.replace(/key=\{\`\$\{visibleSelectedSession\.id\}:\$\{frameKey\}\`\}/g, `key={visibleSelectedSession.id}`);

// Re-add script dirty state (the previous one was somehow missed or broken).
// We'll replace the script rendering part.
code = code.replace(
  `                <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">\n                  {script?.mode === "script" ? "Custom file" : "Auto-generated fallback"}\n                </div>`,
  `                <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">\n                  {script?.mode === "script" ? "Custom file" : "Auto-generated fallback"}\n                  {scriptDraft !== (script?.content || "") && (\n                    <span className="ml-2 text-xs font-normal text-amber-600 dark:text-amber-400">\n                      (Unsaved changes)\n                    </span>\n                  )}\n                </div>`
);

// Update script load feedback
code = code.replace(
  `    let cancelled = false;\n    void fetchPreviewScript(selectedProject.id, scriptTargetSprint.id)`,
  `    let cancelled = false;\n    setActionFeedback({status: 'pending', message: "Loading script..."});\n    void fetchPreviewScript(selectedProject.id, scriptTargetSprint.id)`
);
code = code.replace(
  `        setScript(data);\n        setScriptDraft(data.content);\n      })`,
  `        setScript(data);\n        setScriptDraft(data.content);\n        setActionFeedback({status: 'success', message: "Script loaded successfully"});\n      })`
);
code = code.replace(
  `        setError(fetchError instanceof Error ? fetchError.message : String(fetchError));\n      });`,
  `        setActionFeedback({status: 'error', message: \`Failed to load script: \${fetchError instanceof Error ? fetchError.message : String(fetchError)}\`});\n      });`
);

// Update start feedback
code = code.replace(
  `    setLaunching(true);\n    try {`,
  `    setLaunching(true);\n    setActionFeedback({status: 'pending', message: "Launching container..."});\n    try {`
);
code = code.replace(
  `      setFrameSrc(\`\${buildPreviewOrigin(session.id)}\${normalizePath(currentPathRef.current)}\`);\n    } catch (actionError) {`,
  `      setFrameSrc(\`\${buildPreviewOrigin(session.id)}\${normalizePath(currentPathRef.current)}\`);\n      setActionFeedback({status: 'success', message: "Container launched successfully"});\n    } catch (actionError) {`
);
code = code.replace(
  `    } catch (actionError) {\n      setError(actionError instanceof Error ? actionError.message : String(actionError));\n    } finally {`,
  `    } catch (actionError) {\n      setActionFeedback({status: 'error', message: \`Failed to launch container: \${actionError instanceof Error ? actionError.message : String(actionError)}\`});\n    } finally {`
);

// Update rebuild feedback
code = code.replace(
  `    setSessionActionPending(true);\n    try {`,
  `    setSessionActionPending(true);\n    setActionFeedback({status: 'pending', message: "Rebuilding container..."});\n    try {`
);
code = code.replace(
  `      await refreshSessions(true);\n      reloadFrame();\n    } catch (actionError) {`,
  `      await refreshSessions(true);\n      reloadFrame();\n      setActionFeedback({status: 'success', message: "Container rebuilt successfully"});\n    } catch (actionError) {`
);
code = code.replace(
  `    } catch (actionError) {\n      setError(actionError instanceof Error ? actionError.message : String(actionError));\n    } finally {`,
  `    } catch (actionError) {\n      setActionFeedback({status: 'error', message: \`Failed to rebuild container: \${actionError instanceof Error ? actionError.message : String(actionError)}\`});\n    } finally {`
);

// Update stop feedback
code = code.replace(
  `    setSessionActionPending(true);\n    try {\n      await stopPreviewSession(visibleSelectedSession.id);`,
  `    setSessionActionPending(true);\n    setActionFeedback({status: 'pending', message: "Stopping container..."});\n    try {\n      await stopPreviewSession(visibleSelectedSession.id);`
);
code = code.replace(
  `      await stopPreviewSession(visibleSelectedSession.id);\n      await refreshSessions(true);\n    } catch (actionError) {`,
  `      await stopPreviewSession(visibleSelectedSession.id);\n      await refreshSessions(true);\n      setActionFeedback({status: 'success', message: "Container stopped successfully"});\n    } catch (actionError) {`
);
code = code.replace(
  `    } catch (actionError) {\n      setError(actionError instanceof Error ? actionError.message : String(actionError));\n    } finally {`,
  `    } catch (actionError) {\n      setActionFeedback({status: 'error', message: \`Failed to stop container: \${actionError instanceof Error ? actionError.message : String(actionError)}\`});\n    } finally {`
);

// Update save script feedback
code = code.replace(
  `    setSavingScript(true);\n    try {`,
  `    setSavingScript(true);\n    setActionFeedback({status: 'pending', message: "Saving script..."});\n    try {`
);
code = code.replace(
  `      setScript(nextScript);\n      setShowScriptEditor(false);\n    } catch (actionError) {`,
  `      setScript(nextScript);\n      setShowScriptEditor(false);\n      setActionFeedback({status: 'success', message: "Script saved successfully"});\n    } catch (actionError) {`
);
code = code.replace(
  `    } catch (actionError) {\n      setError(actionError instanceof Error ? actionError.message : String(actionError));\n    } finally {`,
  `    } catch (actionError) {\n      setActionFeedback({status: 'error', message: \`Failed to save script: \${actionError instanceof Error ? actionError.message : String(actionError)}\`});\n    } finally {`
);

// Add local action feedback UI
const feedbackUI = `
      {actionFeedback.status !== "idle" && actionFeedback.message && (
        <div className="mb-5 flex items-start gap-3 p-3 rounded-xl border bg-black/[0.02] dark:bg-white/[0.03] border-black/[0.06] dark:border-white/[0.06]">
          <div className={\`flex-1 text-sm font-medium mt-0.5 \${actionFeedback.status === 'error' ? 'text-status-red' : actionFeedback.status === 'success' ? 'text-status-green' : 'text-signal-700 dark:text-signal-400'}\`}>
            {actionFeedback.status === 'pending' && <span className="mr-2 inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />}
            {actionFeedback.message}
          </div>
          <button
            type="button"
            onClick={() => setActionFeedback({status: 'idle', message: null})}
            className="shrink-0 p-1 rounded-md opacity-70 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
          >
            <span className="sr-only">Dismiss</span>
            ✕
          </button>
        </div>
      )}
`;

code = code.replace(
  `      {error && (\n        <div className="mb-5 rounded-2xl border border-status-red/20 bg-status-red/10 px-4 py-3 text-sm text-status-red">\n          {error}\n        </div>\n      )}`,
  `      {error && (\n        <div className="mb-5 rounded-2xl border border-status-red/20 bg-status-red/10 px-4 py-3 text-sm text-status-red">\n          {error}\n        </div>\n      )}\n${feedbackUI}`
);

// Buttons loading text
code = code.replace(
  `                  <RotateCcw className="h-4 w-4" strokeWidth={2} />\n                  Rebuild`,
  `                  <RotateCcw className={\`h-4 w-4 \${sessionActionPending ? 'animate-spin' : ''}\`} strokeWidth={2} />\n                  {sessionActionPending ? "Rebuilding..." : "Rebuild"}`
);

code = code.replace(
  `                  <Square className="h-4 w-4" strokeWidth={2} />\n                  Stop`,
  `                  <Square className="h-4 w-4" strokeWidth={2} />\n                  {sessionActionPending ? "Stopping..." : "Stop"}`
);

code = code.replace(
  `                  <Save className="h-4 w-4" strokeWidth={2} />\n                  Save`,
  `                  <Save className="h-4 w-4" strokeWidth={2} />\n                  {savingScript ? "Saving..." : "Save"}`
);

fs.writeFileSync(file, code);
