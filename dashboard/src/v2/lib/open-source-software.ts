import type { DashboardLocale } from "../i18n/locales.js";
import { translateSettingsOperationsMessage } from "../i18n/messages/settings-operations.js";

export type OpenSourceSoftwareUsageArea = "Dashboard" | "Packaged app" | "Runtime";

export const getOpenSourceSoftwareUsageAreaLabel = (
  usageArea: OpenSourceSoftwareUsageArea,
  locale: DashboardLocale,
): string => translateSettingsOperationsMessage(locale, usageArea);

export type OpenSourceSoftwareEntry = Readonly<{
  id: string;
  name: string;
  usageArea: OpenSourceSoftwareUsageArea;
  license: string;
  projectUrl: string;
}>;

/**
 * Direct open-source projects whose code or generated assets are part of the
 * distributed runtime, dashboard, or desktop application. Keep this list
 * static so the legal surface is also available in offline installations.
 */
export const OPEN_SOURCE_SOFTWARE = Object.freeze([
  {
    id: "ajv",
    name: "Ajv",
    usageArea: "Runtime",
    license: "MIT",
    projectUrl: "https://ajv.js.org/",
  },
  {
    id: "anthropic-tokenizer",
    name: "Anthropic Tokenizer",
    usageArea: "Runtime",
    license: "Apache-2.0",
    projectUrl: "https://github.com/anthropics/anthropic-tokenizer-typescript",
  },
  {
    id: "axios",
    name: "Axios",
    usageArea: "Runtime",
    license: "MIT",
    projectUrl: "https://axios-http.com/",
  },
  {
    id: "colord",
    name: "colord",
    usageArea: "Runtime",
    license: "MIT",
    projectUrl: "https://github.com/omgovich/colord",
  },
  {
    id: "dotenv",
    name: "dotenv",
    usageArea: "Runtime",
    license: "BSD-2-Clause",
    projectUrl: "https://github.com/motdotla/dotenv",
  },
  {
    id: "electron",
    name: "Electron",
    usageArea: "Packaged app",
    license: "MIT",
    projectUrl: "https://github.com/electron/electron",
  },
  {
    id: "escape-html",
    name: "escape-html",
    usageArea: "Runtime",
    license: "MIT",
    projectUrl: "https://github.com/component/escape-html",
  },
  {
    id: "express",
    name: "Express",
    usageArea: "Runtime",
    license: "MIT",
    projectUrl: "https://expressjs.com/",
  },
  {
    id: "express-rate-limit",
    name: "express-rate-limit",
    usageArea: "Runtime",
    license: "MIT",
    projectUrl: "https://github.com/express-rate-limit/express-rate-limit",
  },
  {
    id: "gsap",
    name: "GSAP",
    usageArea: "Dashboard",
    license: "Standard 'no charge' license: https://gsap.com/standard-license.",
    projectUrl: "https://gsap.com/",
  },
  {
    id: "js-tiktoken",
    name: "js-tiktoken",
    usageArea: "Runtime",
    license: "MIT",
    projectUrl: "https://github.com/dqbd/tiktoken",
  },
  {
    id: "lucide",
    name: "Lucide",
    usageArea: "Dashboard",
    license: "ISC",
    projectUrl: "https://lucide.dev/",
  },
  {
    id: "mammoth",
    name: "Mammoth.js",
    usageArea: "Runtime",
    license: "BSD-2-Clause",
    projectUrl: "https://github.com/mwilliamson/mammoth.js",
  },
  {
    id: "marked",
    name: "Marked",
    usageArea: "Dashboard",
    license: "MIT",
    projectUrl: "https://marked.js.org/",
  },
  {
    id: "mcp-typescript-sdk",
    name: "Model Context Protocol TypeScript SDK",
    usageArea: "Runtime",
    license: "MIT",
    projectUrl: "https://github.com/modelcontextprotocol/typescript-sdk",
  },
  {
    id: "monaco-editor",
    name: "Monaco Editor",
    usageArea: "Dashboard",
    license: "MIT",
    projectUrl: "https://github.com/microsoft/monaco-editor",
  },
  {
    id: "monaco-react",
    name: "Monaco React",
    usageArea: "Dashboard",
    license: "MIT",
    projectUrl: "https://github.com/suren-atoyan/monaco-react",
  },
  {
    id: "multer",
    name: "Multer",
    usageArea: "Runtime",
    license: "MIT",
    projectUrl: "https://github.com/expressjs/multer",
  },
  {
    id: "onnx-runtime",
    name: "ONNX Runtime",
    usageArea: "Runtime",
    license: "MIT",
    projectUrl: "https://github.com/microsoft/onnxruntime",
  },
  {
    id: "p-limit",
    name: "p-limit",
    usageArea: "Runtime",
    license: "MIT",
    projectUrl: "https://github.com/sindresorhus/p-limit",
  },
  {
    id: "pdf-parse",
    name: "pdf-parse",
    usageArea: "Runtime",
    license: "Apache-2.0",
    projectUrl: "https://mehmet-kozan.github.io/pdf-parse/",
  },
  {
    id: "preact",
    name: "Preact",
    usageArea: "Dashboard",
    license: "MIT",
    projectUrl: "https://preactjs.com/",
  },
  {
    id: "preact-signals",
    name: "Preact Signals",
    usageArea: "Dashboard",
    license: "MIT",
    projectUrl: "https://github.com/preactjs/signals",
  },
  {
    id: "react-arborist",
    name: "React Arborist",
    usageArea: "Dashboard",
    license: "MIT",
    projectUrl: "https://github.com/jameskerr/react-arborist",
  },
  {
    id: "tailwindcss",
    name: "Tailwind CSS",
    usageArea: "Dashboard",
    license: "MIT",
    projectUrl: "https://tailwindcss.com/",
  },
  {
    id: "tailwindcss-typography",
    name: "Tailwind CSS Typography",
    usageArea: "Dashboard",
    license: "MIT",
    projectUrl: "https://github.com/tailwindlabs/tailwindcss-typography",
  },
  {
    id: "tanstack-router",
    name: "TanStack Router",
    usageArea: "Dashboard",
    license: "MIT",
    projectUrl: "https://tanstack.com/router/",
  },
  {
    id: "three-js",
    name: "three.js",
    usageArea: "Dashboard",
    license: "MIT",
    projectUrl: "https://threejs.org/",
  },
] as const satisfies readonly OpenSourceSoftwareEntry[]);
