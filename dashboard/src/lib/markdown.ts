import { marked } from "marked";

const renderer = new marked.Renderer();
renderer.html = () => "";

const isUrlSafe = (url: string): boolean => {
  try {
    const trimmed = url.trim();
    if (trimmed.startsWith("/") || trimmed.startsWith("#") || trimmed.startsWith("?")) {
      return true;
    }
    const parsed = new URL(trimmed, "http://dummy.com");
    return ["http:", "https:", "mailto:"].includes(parsed.protocol);
  } catch {
    return false;
  }
};

const escapeHtml = (html: string): string => {
  return html
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
};

renderer.link = function (token) {
  const { href, title, tokens } = token;
  const parsedText = this.parser.parseInline(tokens);

  if (!isUrlSafe(href)) {
    return parsedText;
  }

  let out = `<a href="${escapeHtml(href.trim())}"`;
  if (title) {
    out += ` title="${escapeHtml(title)}"`;
  }

  if (/^https?:\/\//i.test(href.trim()) || href.trim().startsWith("//")) {
    out += ` rel="noopener noreferrer"`;
  }

  out += `>${parsedText}</a>`;
  return out as any;
};

renderer.image = function (token) {
  const { href, title, text } = token;
  if (!isUrlSafe(href)) {
    return escapeHtml(text);
  }

  let out = `<img src="${escapeHtml(href.trim())}" alt="${escapeHtml(text)}"`;
  if (title) {
    out += ` title="${escapeHtml(title)}"`;
  }
  out += ">";
  return out as any;
};

export const renderMarkdown = (text?: string): string => {
  if (!text) return "";
  return marked.parse(text, { renderer }) as string;
};
