import { marked } from "marked";

const renderer = new marked.Renderer();
renderer.html = () => "";

export const renderMarkdown = (text?: string): string => {
  if (!text) return "";
  return marked.parse(text, { renderer }) as string;
};
