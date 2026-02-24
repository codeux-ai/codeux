import { marked } from "marked";

export const renderMarkdown = (text?: string): string => {
  if (!text) return "";
  return marked.parse(text) as string;
};
