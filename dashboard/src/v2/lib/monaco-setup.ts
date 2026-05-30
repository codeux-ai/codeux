import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";

export const MONACO_DARK_THEME = "codeux-dark";
export const MONACO_LIGHT_THEME = "codeux-light";

let configured = false;

/**
 * Wires Monaco to the locally bundled `monaco-editor` package (no CDN fetch) and
 * registers language web-workers so the in-app file browser works fully offline,
 * including in the Electron desktop build.
 */
export function ensureMonacoConfigured(): void {
  if (configured) {
    return;
  }
  configured = true;

  // Self-hosted web workers — required for JSON/TS/CSS/HTML language services.
  (self as unknown as { MonacoEnvironment?: monaco.Environment }).MonacoEnvironment = {
    getWorker(_workerId: string, label: string) {
      switch (label) {
        case "json":
          return new jsonWorker();
        case "css":
        case "scss":
        case "less":
          return new cssWorker();
        case "html":
        case "handlebars":
        case "razor":
          return new htmlWorker();
        case "typescript":
        case "javascript":
          return new tsWorker();
        default:
          return new editorWorker();
      }
    },
  };

  monaco.editor.defineTheme(MONACO_DARK_THEME, {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "5b6472", fontStyle: "italic" },
      { token: "keyword", foreground: "33ffb8" },
      { token: "string", foreground: "ffd080" },
      { token: "number", foreground: "80ffd6" },
      { token: "type", foreground: "8be9fd" },
    ],
    colors: {
      "editor.background": "#05080d",
      "editor.foreground": "#e2e8f0",
      "editorLineNumber.foreground": "#3a424f",
      "editorLineNumber.activeForeground": "#00e0a0",
      "editor.selectionBackground": "#00e0a033",
      "editor.lineHighlightBackground": "#ffffff08",
      "editorCursor.foreground": "#00e0a0",
      "editorIndentGuide.background1": "#ffffff0d",
      "diffEditor.insertedTextBackground": "#00e0a022",
      "diffEditor.removedTextBackground": "#ff336622",
      "diffEditor.insertedLineBackground": "#00e0a014",
      "diffEditor.removedLineBackground": "#ff336614",
    },
  });

  monaco.editor.defineTheme(MONACO_LIGHT_THEME, {
    base: "vs",
    inherit: true,
    rules: [
      { token: "comment", foreground: "94a3b8", fontStyle: "italic" },
      { token: "keyword", foreground: "0d9488" },
      { token: "string", foreground: "b45309" },
    ],
    colors: {
      "editor.background": "#f7f3ea",
      "editor.foreground": "#1e293b",
      "editorLineNumber.foreground": "#cbd5e1",
      "editorLineNumber.activeForeground": "#0d9488",
      "editor.selectionBackground": "#00e0a033",
      "editor.lineHighlightBackground": "#00000008",
      "editorCursor.foreground": "#0d9488",
      "diffEditor.insertedTextBackground": "#00e0a026",
      "diffEditor.removedTextBackground": "#ff336622",
      "diffEditor.insertedLineBackground": "#00e0a018",
      "diffEditor.removedLineBackground": "#ff336614",
    },
  });

  loader.config({ monaco });
}
