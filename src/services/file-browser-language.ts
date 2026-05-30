const EXTENSION_LANGUAGE: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  jsonc: "json",
  json5: "json",
  css: "css",
  scss: "scss",
  sass: "scss",
  less: "less",
  html: "html",
  htm: "html",
  xml: "xml",
  svg: "xml",
  vue: "html",
  svelte: "html",
  md: "markdown",
  markdown: "markdown",
  mdx: "markdown",
  yaml: "yaml",
  yml: "yaml",
  toml: "ini",
  ini: "ini",
  env: "ini",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  fish: "shell",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  sql: "sql",
  graphql: "graphql",
  gql: "graphql",
  dockerfile: "dockerfile",
  proto: "protobuf",
  lua: "lua",
  r: "r",
  dart: "dart",
  scala: "scala",
  pl: "perl",
  bat: "bat",
  ps1: "powershell",
};

const FILENAME_LANGUAGE: Record<string, string> = {
  dockerfile: "dockerfile",
  makefile: "makefile",
  ".gitignore": "ignore",
  ".dockerignore": "ignore",
  ".npmignore": "ignore",
  ".env": "ini",
};

/**
 * Resolves a Monaco-compatible language identifier for a given file path.
 * Returns null when the language cannot be inferred (Monaco falls back to plaintext).
 */
export function resolveLanguageForPath(filePath: string): string | null {
  const segments = filePath.split("/");
  const fileName = (segments[segments.length - 1] || "").toLowerCase();
  if (FILENAME_LANGUAGE[fileName]) {
    return FILENAME_LANGUAGE[fileName];
  }
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex <= 0) {
    return null;
  }
  const ext = fileName.slice(dotIndex + 1);
  return EXTENSION_LANGUAGE[ext] || null;
}
